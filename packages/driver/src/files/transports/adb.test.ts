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
const out = (stdout = ''): HostExecResult => ({ stdout: Buffer.from(stdout), stderr: '', code: 0 })
// The device command adb forwards to the shell — args[3] after `-s <serial> exec-out`.
const deviceCommand = (call: Call | undefined): string => call?.args[3] ?? ''
const isProbe = (call: Call): boolean => deviceCommand(call).includes('if [ -r ')

const ABS = '/data/data/com.acme.app/files/obs.csv'

describe('adb transport — pull (REQ-XPORT-004)', () => {
  it('probes readability then reads bytes over exec-out, binary-clean', async () => {
    const { exec, calls } = fakeExec((call) =>
      isProbe(call) ? out('__RN_PW_FILE_OK__\n') : out('csv-bytes'),
    )
    const transport = createAdbTransport(CONFIG, exec)

    const bytes = await transport.pull(
      { absolute: false, subpath: 'files/obs.csv' },
      { maxBuffer: 4096 },
    )

    // Probe: existence/readability signalled on stdout (the only reliable channel).
    expect(calls[0]?.command).toBe('adb')
    expect(calls[0]?.args).toEqual([
      '-s',
      'emulator-5554',
      'exec-out',
      `run-as com.acme.app sh -c 'if [ -r "${ABS}" ]; then echo __RN_PW_FILE_OK__; elif [ -e "${ABS}" ]; then echo __RN_PW_FILE_DENIED__; else echo __RN_PW_FILE_MISSING__; fi'`,
    ])
    // Read: only after the probe confirms readability; maxBuffer is threaded through.
    expect(calls[1]?.args).toEqual([
      '-s',
      'emulator-5554',
      'exec-out',
      `run-as com.acme.app sh -c 'cat "${ABS}"'`,
    ])
    expect(calls[1]?.options?.maxBuffer).toBe(4096)
    expect(bytes.toString()).toBe('csv-bytes')
  })

  it('uses an absolute path verbatim', async () => {
    const { exec, calls } = fakeExec((call) => (isProbe(call) ? out('__RN_PW_FILE_OK__') : out()))
    await createAdbTransport(CONFIG, exec).pull(
      { absolute: true, path: '/sdcard/x' },
      { maxBuffer: 1 },
    )
    expect(deviceCommand(calls[0])).toContain('"/sdcard/x"')
    expect(deviceCommand(calls[1])).toBe(`run-as com.acme.app sh -c 'cat "/sdcard/x"'`)
  })

  it('maps a missing file (stdout sentinel, exit 0) to NOT_FOUND and never reads', async () => {
    // The real failure: exec-out exits 0 with the error on stdout, so the old
    // exit-code check returned the error text as bytes. The probe catches it.
    const { exec, calls } = fakeExec(() => out('__RN_PW_FILE_MISSING__\n'))
    await expect(
      createAdbTransport(CONFIG, exec).pull(
        { absolute: false, subpath: 'files/x' },
        { maxBuffer: 1 },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(calls).toHaveLength(1) // fail closed before the cat
  })

  it('maps a non-debuggable build (run-as text folded into stdout) to UNSUPPORTED', async () => {
    const { exec } = fakeExec(() => out('run-as: package not debuggable: com.acme.app\n'))
    await expect(
      createAdbTransport(CONFIG, exec).pull(
        { absolute: false, subpath: 'files/x' },
        { maxBuffer: 1 },
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' })
  })

  it('maps a present-but-unreadable file to TRANSPORT_FAILED', async () => {
    const { exec } = fakeExec(() => out('__RN_PW_FILE_DENIED__\n'))
    await expect(
      createAdbTransport(CONFIG, exec).pull(
        { absolute: false, subpath: 'files/x' },
        { maxBuffer: 1 },
      ),
    ).rejects.toMatchObject({ code: 'TRANSPORT_FAILED' })
  })

  it('maps a maxBuffer overflow on the read to TOO_LARGE', async () => {
    const { exec } = fakeExec((call) => {
      if (isProbe(call)) return out('__RN_PW_FILE_OK__')
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
    const { exec, calls } = fakeExec(() => out())
    await expect(
      createAdbTransport(CONFIG, exec).pull(
        { absolute: false, subpath: "files/o'brien.csv" },
        { maxBuffer: 1 },
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    expect(calls).toHaveLength(0)
  })

  it('rejects a shell metacharacter ($) in the path before spawning', async () => {
    const { exec, calls } = fakeExec(() => out())
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
    const { exec, calls } = fakeExec(() => out('__RN_PW_PUSH_OK__\n'))
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
