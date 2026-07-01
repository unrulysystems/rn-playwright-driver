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

const ok = (stdout = ''): HostExecResult => ({ stdout: Buffer.from(stdout), stderr: '', code: 0 })
const fail = (stderr: string, code = 1): HostExecResult => ({
  stdout: Buffer.alloc(0),
  stderr,
  code,
})

describe('adb transport — pull (REQ-XPORT-004)', () => {
  it('runs exec-out run-as cat against the app-private absolute path', async () => {
    const { exec, calls } = fakeExec(() => ok('csv-bytes'))
    const transport = createAdbTransport(CONFIG, exec)

    const bytes = await transport.pull(
      { absolute: false, subpath: 'files/obs.csv' },
      { maxBuffer: 4096 },
    )

    expect(calls[0]?.command).toBe('adb')
    expect(calls[0]?.args).toEqual([
      '-s',
      'emulator-5554',
      'exec-out',
      'run-as',
      'com.acme.app',
      'cat',
      '/data/data/com.acme.app/files/obs.csv',
    ])
    expect(calls[0]?.options?.maxBuffer).toBe(4096)
    expect(bytes.toString()).toBe('csv-bytes')
  })

  it('uses an absolute path verbatim', async () => {
    const { exec, calls } = fakeExec(() => ok())
    await createAdbTransport(CONFIG, exec).pull(
      { absolute: true, path: '/sdcard/x' },
      { maxBuffer: 1 },
    )
    expect(calls[0]?.args.at(-1)).toBe('/sdcard/x')
  })

  it('maps a missing file (cat stderr) to NOT_FOUND', async () => {
    const { exec } = fakeExec(() => fail('cat: /data/.../x: No such file or directory'))
    await expect(
      createAdbTransport(CONFIG, exec).pull(
        { absolute: false, subpath: 'files/x' },
        { maxBuffer: 1 },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('maps a non-debuggable build to UNSUPPORTED', async () => {
    const { exec } = fakeExec(() => fail('run-as: package not debuggable: com.acme.app'))
    await expect(
      createAdbTransport(CONFIG, exec).pull(
        { absolute: false, subpath: 'files/x' },
        { maxBuffer: 1 },
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' })
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
    const { exec, calls } = fakeExec(() => ok())
    await expect(
      createAdbTransport(CONFIG, exec).pull(
        { absolute: false, subpath: "files/o'brien.csv" },
        { maxBuffer: 1 },
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    expect(calls).toHaveLength(0)
  })
})

describe('adb transport — push', () => {
  it('pipes bytes via stdin into a run-as sh -c mkdir+cat script', async () => {
    const { exec, calls } = fakeExec(() => ok())
    const data = Buffer.from('seed')

    await createAdbTransport(CONFIG, exec).push(
      { absolute: false, subpath: 'files/seed.json' },
      data,
    )

    expect(calls[0]?.args.slice(0, 3)).toEqual(['-s', 'emulator-5554', 'shell'])
    expect(calls[0]?.args[3]).toBe(
      "run-as com.acme.app sh -c 'mkdir -p /data/data/com.acme.app/files && cat > /data/data/com.acme.app/files/seed.json'",
    )
    expect(calls[0]?.options?.stdin).toBe(data)
  })

  it('maps a run-as push failure to the taxonomy', async () => {
    const { exec } = fakeExec(() => fail('run-as: package not debuggable: com.acme.app', 1))
    await expect(
      createAdbTransport(CONFIG, exec).push(
        { absolute: false, subpath: 'files/x' },
        Buffer.from('x'),
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' })
  })
})
