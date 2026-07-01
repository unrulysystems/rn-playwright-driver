import { describe, expect, it } from 'vitest'
import type { HostExecResult, HostFileExec, HostFileExecOptions } from '../host-file-exec'
import type { HostFs } from '../host-fs'
import type { ResolvedFileTarget } from '../target'
import { selectFileTransport, withDefaultTimeout } from './index'

function harness() {
  const commands: string[] = []
  const exec: HostFileExec = async (command, args) => {
    commands.push(`${command} ${args[0] ?? ''}`)
    // The adb read is one atomic `cat …; printf __RN_PW_READ__$?` command; answer
    // it with a valid sentinel-terminated stdout so routing reaches the
    // transport, not a fail-closed throw. Everything else gets a container stub.
    const stdout = args.join(' ').includes('__RN_PW_READ__')
      ? Buffer.from('__RN_PW_READ__0')
      : Buffer.from('/container')
    return { stdout, stderr: '', code: 0 }
  }
  const fs: HostFs = {
    readFile: async () => Buffer.from('x'),
    writeFile: async () => {},
    mkdtempDir: async () => '/tmp/x',
    remove: async () => {},
    realpath: async (path) => path,
  }
  return { commands, deps: { exec, fs } }
}

describe('selectFileTransport (REQ-XPORT-001)', () => {
  it('routes Android to the adb transport', async () => {
    const { commands, deps } = harness()
    const target: ResolvedFileTarget = {
      platform: 'android',
      serial: 's',
      packageName: 'com.acme.app',
      adbPath: 'adb',
    }
    await selectFileTransport(target, deps).pull(
      { absolute: false, subpath: 'files/x' },
      { maxBuffer: 1 },
    )
    expect(commands[0]).toBe('adb -s')
  })

  it('routes an iOS simulator to the simctl transport', async () => {
    const { commands, deps } = harness()
    const target: ResolvedFileTarget = {
      platform: 'ios',
      kind: 'simulator',
      udid: 'u',
      bundleId: 'com.acme.app',
      xcrunPath: 'xcrun',
    }
    await selectFileTransport(target, deps).pull(
      { absolute: false, subpath: 'Documents/x' },
      { maxBuffer: 1 },
    )
    expect(commands[0]).toBe('xcrun simctl')
  })

  it('routes an iOS device to the devicectl transport', async () => {
    const { commands, deps } = harness()
    const target: ResolvedFileTarget = {
      platform: 'ios',
      kind: 'device',
      udid: 'u',
      bundleId: 'com.acme.app',
      xcrunPath: 'xcrun',
    }
    await selectFileTransport(target, deps).pull(
      { absolute: false, subpath: 'Documents/x' },
      { maxBuffer: 1 },
    )
    expect(commands[0]).toBe('xcrun devicectl')
  })
})

describe('withDefaultTimeout', () => {
  function recorder() {
    const seen: (HostFileExecOptions | undefined)[] = []
    const base: HostFileExec = async (_command, _args, options) => {
      seen.push(options)
      return { stdout: Buffer.alloc(0), stderr: '', code: 0 } satisfies HostExecResult
    }
    return { seen, base }
  }

  it('injects the default timeout when a call omits one (bounds hung CLIs)', async () => {
    const { seen, base } = recorder()
    await withDefaultTimeout(base, 5000)('adb', ['devices'])
    expect(seen[0]?.timeoutMs).toBe(5000)
  })

  it('lets a per-call timeout override the default', async () => {
    const { seen, base } = recorder()
    await withDefaultTimeout(base, 5000)('adb', ['devices'], { timeoutMs: 99, maxBuffer: 8 })
    expect(seen[0]).toMatchObject({ timeoutMs: 99, maxBuffer: 8 })
  })

  it('returns the base exec unchanged when no default is set', () => {
    const { base } = recorder()
    expect(withDefaultTimeout(base)).toBe(base)
  })
})
