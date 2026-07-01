import { describe, expect, it } from 'vitest'
import type { HostFileExec } from '../host-file-exec'
import type { HostFs } from '../host-fs'
import type { ResolvedFileTarget } from '../target'
import { selectFileTransport } from './index'

function harness() {
  const commands: string[] = []
  const exec: HostFileExec = async (command, args) => {
    commands.push(`${command} ${args[0] ?? ''}`)
    return { stdout: Buffer.from('/container'), stderr: '', code: 0 }
  }
  const fs: HostFs = {
    readFile: async () => Buffer.from('x'),
    writeFile: async () => {},
    mkdtempDir: async () => '/tmp/x',
    remove: async () => {},
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
