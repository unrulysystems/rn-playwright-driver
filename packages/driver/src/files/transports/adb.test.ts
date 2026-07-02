import { describe, expect, it } from 'vitest'
import {
  HostExecMaxBufferError,
  type HostExecResult,
  type HostFileExec,
  type HostFileExecOptions,
} from '../host-file-exec'
import { createAdbTransport } from './adb'

const CONFIG = { serial: 'emulator-5554', packageName: 'com.acme.app', adbPath: 'adb' }

type Call = { command: string; args: string[]; options?: HostFileExecOptions | undefined }

function fakeExec(impl: (call: Call) => HostExecResult | Promise<HostExecResult>) {
  const calls: Call[] = []
  const exec: HostFileExec = async (command, args, options) => {
    const call = { command, args: [...args], options }
    calls.push(call)
    return impl(call)
  }
  return { exec, calls }
}

// `adb exec-out` always exits 0 and folds the remote stderr into stdout, so the
// fakes model outcomes on stdout — never via a nonzero code or a clean stderr.
// The read carries `<bytes>__RN_PW_READ__<cat-exit>`; helpers build that shape.
const readOk = (bytes: string): HostExecResult => ({
  stdout: Buffer.from(`${bytes}__RN_PW_READ__0`),
  stderr: '',
  code: 0,
})
const readFail = (foldedStderr: string, catExit = 1): HostExecResult => ({
  stdout: Buffer.from(`${foldedStderr}__RN_PW_READ__${catExit}`),
  stderr: '',
  code: 0,
})
const noSentinel = (stdout: string): HostExecResult => ({
  stdout: Buffer.from(stdout),
  stderr: '',
  code: 0,
})
// The device command adb forwards to the shell — args[3] after `-s <serial> exec-out`.
const deviceCommand = (call: Call | undefined): string => call?.args[3] ?? ''

const ABS = '/data/data/com.acme.app/files/obs.csv'

describe('adb transport — pull (REQ-XPORT-004)', () => {
  it('reads bytes in one atomic sentinel-terminated command, binary-clean', async () => {
    const { exec, calls } = fakeExec(() => readOk('csv-bytes'))
    const transport = createAdbTransport(CONFIG, exec)

    const bytes = await transport.pull(
      { absolute: false, subpath: 'files/obs.csv' },
      { maxBuffer: 4096 },
    )

    expect(calls).toHaveLength(1) // single round-trip: no separate probe, no TOCTOU window
    expect(calls[0]?.command).toBe('adb')
    expect(calls[0]?.args).toEqual([
      '-s',
      'emulator-5554',
      'exec-out',
      `run-as com.acme.app sh -c 'cat "${ABS}" 2>&1; printf "__RN_PW_READ__%d" $?'`,
    ])
    // The exec cap gets diagnostic headroom so the sentinel/errors always parse;
    // the file body is then enforced against maxBuffer exactly (REQ-FILES-005/008).
    expect(calls[0]?.options?.maxBuffer).toBe(4096 + 64 * 1024)
    expect(bytes.toString()).toBe('csv-bytes') // sentinel + exit code stripped
  })

  it('enforces maxBuffer exactly on the file body (not the padded exec cap)', async () => {
    // Body of 5 bytes with maxBuffer 4 → TOO_LARGE, even though the read had
    // headroom and the exec did not overflow.
    const { exec } = fakeExec(() => readOk('12345'))
    await expect(
      createAdbTransport(CONFIG, exec).pull(
        { absolute: false, subpath: 'files/x' },
        { maxBuffer: 4 },
      ),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' })
  })

  it('classifies a missing file as NOT_FOUND regardless of a small maxBuffer', async () => {
    // Headroom means the folded diagnostic is parsed instead of overflowing to
    // TOO_LARGE, so a tiny cap still yields the correct taxonomy.
    const { exec } = fakeExec(() => readFail('cat: /data/.../x: No such file or directory\n'))
    await expect(
      createAdbTransport(CONFIG, exec).pull(
        { absolute: false, subpath: 'files/x' },
        { maxBuffer: 4 },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('recovers file bytes that themselves contain the sentinel token', async () => {
    // Splitting on the LAST sentinel must preserve an embedded token in the file.
    const { exec } = fakeExec(() => ({
      stdout: Buffer.from('A__RN_PW_READ__9B__RN_PW_READ__0'),
      stderr: '',
      code: 0,
    }))
    const bytes = await createAdbTransport(CONFIG, exec).pull(
      { absolute: false, subpath: 'files/x' },
      { maxBuffer: 64 },
    )
    expect(bytes.toString()).toBe('A__RN_PW_READ__9B')
  })

  it('uses an absolute path verbatim', async () => {
    const { exec, calls } = fakeExec(() => readOk(''))
    await createAdbTransport(CONFIG, exec).pull(
      { absolute: true, path: '/sdcard/x' },
      { maxBuffer: 1 },
    )
    expect(deviceCommand(calls[0])).toBe(
      `run-as com.acme.app sh -c 'cat "/sdcard/x" 2>&1; printf "__RN_PW_READ__%d" $?'`,
    )
  })

  it('maps a missing file (cat exit 1, error folded into stdout) to NOT_FOUND', async () => {
    // The real failure: exec-out exits 0 with cat's error on stdout. The sentinel
    // carries cat's own exit code (1), so the error text is never returned as bytes.
    // A realistic maxBuffer (not 1) — with a tiny cap the diagnostic itself would
    // overflow to TOO_LARGE before the sentinel is parsed, which is fail-closed too.
    const { exec } = fakeExec(() => readFail('cat: /data/.../x: No such file or directory\n'))
    await expect(
      createAdbTransport(CONFIG, exec).pull(
        { absolute: false, subpath: 'files/x' },
        { maxBuffer: 64 * 1024 },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('maps a non-debuggable build (no sentinel — the shell never ran) to UNSUPPORTED', async () => {
    const { exec } = fakeExec(() => noSentinel('run-as: package not debuggable: com.acme.app\n'))
    await expect(
      createAdbTransport(CONFIG, exec).pull(
        { absolute: false, subpath: 'files/x' },
        { maxBuffer: 1 },
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' })
  })

  it('maps `run-as: package not found` to UNSUPPORTED, not NOT_FOUND', async () => {
    // "package not found" also matches the broad /not found/ marker; the
    // container-access branch must win (it is a debuggable/package issue).
    const { exec } = fakeExec(() => noSentinel('run-as: package not found: com.acme.app\n'))
    await expect(
      createAdbTransport(CONFIG, exec).pull(
        { absolute: false, subpath: 'files/x' },
        { maxBuffer: 1 },
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' })
  })

  it('maps a present-but-unreadable file (cat exit 1, permission denied) to TRANSPORT_FAILED', async () => {
    const { exec } = fakeExec(() => readFail('cat: /data/.../x: Permission denied\n'))
    await expect(
      createAdbTransport(CONFIG, exec).pull(
        { absolute: false, subpath: 'files/x' },
        { maxBuffer: 1 },
      ),
    ).rejects.toMatchObject({ code: 'TRANSPORT_FAILED' })
  })

  it('maps a maxBuffer overflow to TOO_LARGE', async () => {
    const { exec } = fakeExec(() => {
      throw new HostExecMaxBufferError(64)
    })
    await expect(
      createAdbTransport(CONFIG, exec).pull(
        { absolute: false, subpath: 'files/big' },
        { maxBuffer: 64 },
      ),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' })
  })

  // Every shell-breaking character UNSAFE_PATH guards must be rejected before any
  // spawn — dropping one from the class would silently reopen device-side
  // `run-as … sh -c` injection. Cover the FULL set on pull, not a sample.
  it.each([
    ['single quote', "files/o'brien.csv"],
    ['double quote', 'files/a"b.csv'],
    ['backtick', 'files/a`whoami`.csv'],
    ['dollar', 'files/$(rm -rf).csv'],
    ['backslash', 'files/a\\b.csv'],
    ['newline', 'files/a\nb.csv'],
    ['carriage return', 'files/a\rb.csv'],
  ])('rejects %s in the path (fail-closed) before spawning — pull', async (_label, subpath) => {
    const { exec, calls } = fakeExec(() => readOk(''))
    await expect(
      createAdbTransport(CONFIG, exec).pull({ absolute: false, subpath }, { maxBuffer: 1 }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    expect(calls).toHaveLength(0)
  })

  // push interpolates the path into the SAME device-side script, so it must reject
  // the identical class before spawning.
  it.each([
    ['single quote', "files/o'brien.csv"],
    ['double quote', 'files/a"b.csv'],
    ['backtick', 'files/a`whoami`.csv'],
    ['dollar', 'files/$(rm -rf).csv'],
    ['backslash', 'files/a\\b.csv'],
    ['newline', 'files/a\nb.csv'],
    ['carriage return', 'files/a\rb.csv'],
  ])('rejects %s in the path (fail-closed) before spawning — push', async (_label, subpath) => {
    const { exec, calls } = fakeExec(() => noSentinel('__RN_PW_PUSH_OK__\n'))
    await expect(
      createAdbTransport(CONFIG, exec).push({ absolute: false, subpath }, Buffer.from('x')),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    expect(calls).toHaveLength(0)
  })
})

describe('adb transport — push', () => {
  it('pipes bytes via stdin into a run-as script that echoes a success sentinel', async () => {
    const { exec, calls } = fakeExec(() => noSentinel('__RN_PW_PUSH_OK__\n'))
    const data = Buffer.from('seed')

    await createAdbTransport(CONFIG, exec).push(
      { absolute: false, subpath: 'files/seed.json' },
      data,
    )

    expect(calls[0]?.args.slice(0, 3)).toEqual(['-s', 'emulator-5554', 'shell'])
    expect(calls[0]?.args[3]).toBe(
      `run-as com.acme.app sh -c 'mkdir -p "/data/data/com.acme.app/files" && cat > "/data/data/com.acme.app/files/seed.json" && echo __RN_PW_PUSH_OK__'`,
    )
    expect(calls[0]?.options?.stdin).toBe(data)
  })

  it('creates intermediate parent directories for a nested push path (REQ-FILES-006)', async () => {
    const { exec, calls } = fakeExec(() => noSentinel('__RN_PW_PUSH_OK__\n'))

    await createAdbTransport(CONFIG, exec).push(
      { absolute: false, subpath: 'files/exports/2026/obs.csv' },
      Buffer.from('x'),
    )

    expect(calls[0]?.args[3]).toContain('mkdir -p "/data/data/com.acme.app/files/exports/2026"')
  })

  it('fails closed when the success sentinel is absent (no exit code to trust)', async () => {
    // run-as failure text, exit 0, and no PUSH_OK — the write did not land.
    const { exec } = fakeExec(() => ({
      stdout: Buffer.alloc(0),
      stderr: 'run-as: package not debuggable: com.acme.app',
      code: 0,
    }))
    await expect(
      createAdbTransport(CONFIG, exec).push(
        { absolute: false, subpath: 'files/x' },
        Buffer.from('x'),
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' })
  })

  it('fails closed on a nonzero adb process code even if stdout ends with the sentinel', async () => {
    // The remote shell exit code does not survive adb, but the LOCAL adb code
    // does (device gone / adb broke). A trailing sentinel must not override it.
    const { exec } = fakeExec(() => ({
      stdout: Buffer.from('__RN_PW_PUSH_OK__\n'),
      stderr: 'adb: device offline',
      code: 1,
    }))
    await expect(
      createAdbTransport(CONFIG, exec).push(
        { absolute: false, subpath: 'files/x' },
        Buffer.from('x'),
      ),
    ).rejects.toMatchObject({ code: 'TRANSPORT_FAILED' })
  })

  it('rejects an unsafe remote path before spawning (push embeds it in `cat >`)', async () => {
    // push interpolates the resolved path into a device shell redirection, so the
    // same metacharacter guard as pull must reject before any adb spawn.
    const { exec, calls } = fakeExec(() => noSentinel('__RN_PW_PUSH_OK__\n'))
    await expect(
      createAdbTransport(CONFIG, exec).push(
        { absolute: false, subpath: 'files/$(rm -rf ~).json' },
        Buffer.from('x'),
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    expect(calls).toHaveLength(0)
  })

  it('fails closed when the sentinel appears mid-output but not at the end (spoof guard)', async () => {
    // A failure diagnostic echoing a path that contains the token must not be
    // read as success: the real echo is the LAST thing on stdout.
    const { exec } = fakeExec(() => ({
      stdout: Buffer.from('cat: /data/data/com.acme.app/files/__RN_PW_PUSH_OK__x: No such file\n'),
      stderr: '',
      code: 0,
    }))
    await expect(
      createAdbTransport(CONFIG, exec).push(
        { absolute: false, subpath: 'files/x' },
        Buffer.from('x'),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
