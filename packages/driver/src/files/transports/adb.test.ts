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
      `run-as com.acme.app sh -c 'cat "${ABS}"; printf "__RN_PW_READ__%d" $?'`,
    ])
    expect(calls[0]?.options?.maxBuffer).toBe(4096)
    expect(bytes.toString()).toBe('csv-bytes') // sentinel + exit code stripped
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
      `run-as com.acme.app sh -c 'cat "/sdcard/x"; printf "__RN_PW_READ__%d" $?'`,
    )
  })

  it('maps a missing file (cat exit 1, error folded into stdout) to NOT_FOUND', async () => {
    // The real failure: exec-out exits 0 with cat's error on stdout. The sentinel
    // carries cat's own exit code (1), so the error text is never returned as bytes.
    const { exec } = fakeExec(() => readFail('cat: /data/.../x: No such file or directory\n'))
    await expect(
      createAdbTransport(CONFIG, exec).pull(
        { absolute: false, subpath: 'files/x' },
        { maxBuffer: 1 },
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

  it('rejects a single-quote in the path (fail-closed) before spawning', async () => {
    const { exec, calls } = fakeExec(() => readOk(''))
    await expect(
      createAdbTransport(CONFIG, exec).pull(
        { absolute: false, subpath: "files/o'brien.csv" },
        { maxBuffer: 1 },
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    expect(calls).toHaveLength(0)
  })

  it('rejects a shell metacharacter ($) in the path before spawning', async () => {
    const { exec, calls } = fakeExec(() => readOk(''))
    await expect(
      createAdbTransport(CONFIG, exec).pull(
        { absolute: false, subpath: 'files/$(rm -rf).csv' },
        { maxBuffer: 1 },
      ),
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
})
