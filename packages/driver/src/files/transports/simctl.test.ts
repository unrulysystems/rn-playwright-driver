import { describe, expect, it } from 'vitest'
import { FileIoError } from '../errors'
import type { HostExecResult, HostFileExec } from '../host-file-exec'
import type { HostFs } from '../host-fs'
import { createSimctlTransport } from './simctl'

const CONFIG = { udid: 'UDID-1', bundleId: 'com.acme.app', xcrunPath: 'xcrun' }

type Call = { command: string; args: string[] }

function fakeExec(impl: (call: Call) => HostExecResult) {
  const calls: Call[] = []
  const exec: HostFileExec = async (command, args) => {
    const call = { command, args: [...args] }
    calls.push(call)
    return impl(call)
  }
  return { exec, calls }
}

function ok(stdout: string): HostExecResult {
  return { stdout: Buffer.from(stdout), stderr: '', code: 0 }
}

function fakeFs(overrides: Partial<HostFs>): {
  fs: HostFs
  reads: string[]
  writes: [string, Buffer][]
} {
  const reads: string[] = []
  const writes: [string, Buffer][] = []
  const fs: HostFs = {
    readFile: async (path) => {
      reads.push(path)
      return Buffer.from(`@${path}`)
    },
    writeFile: async (path, data) => {
      writes.push([path, data])
    },
    mkdtempDir: async () => '/tmp/x',
    remove: async () => {},
    ...overrides,
  }
  return { fs, reads, writes }
}

describe('simctl transport', () => {
  it('resolves the container then reads the joined host path (REQ-XPORT-002)', async () => {
    const { exec, calls } = fakeExec(() => ok('/sim/Containers/Data/App/ABC\n'))
    const { fs, reads } = fakeFs({})
    const transport = createSimctlTransport(CONFIG, exec, fs)

    const bytes = await transport.pull(
      { absolute: false, subpath: 'Documents/obs.csv' },
      { maxBuffer: 1 },
    )

    expect(calls[0]).toEqual({
      command: 'xcrun',
      args: ['simctl', 'get_app_container', 'UDID-1', 'com.acme.app', 'data'],
    })
    expect(reads).toEqual(['/sim/Containers/Data/App/ABC/Documents/obs.csv'])
    expect(bytes.toString()).toBe('@/sim/Containers/Data/App/ABC/Documents/obs.csv')
  })

  it('writes to the joined host path on push', async () => {
    const { exec } = fakeExec(() => ok('/sim/ABC'))
    const { fs, writes } = fakeFs({})
    const transport = createSimctlTransport(CONFIG, exec, fs)

    await transport.push({ absolute: false, subpath: 'Documents/seed.json' }, Buffer.from('x'))

    expect(writes[0]?.[0]).toBe('/sim/ABC/Documents/seed.json')
  })

  it('maps an ENOENT read to NOT_FOUND', async () => {
    const { exec } = fakeExec(() => ok('/sim/ABC'))
    const enoent = Object.assign(new Error('missing'), { code: 'ENOENT' })
    const { fs } = fakeFs({
      readFile: async () => {
        throw enoent
      },
    })
    const transport = createSimctlTransport(CONFIG, exec, fs)

    await expect(
      transport.pull({ absolute: false, subpath: 'Documents/x' }, { maxBuffer: 1 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('maps a failing get_app_container to TRANSPORT_FAILED', async () => {
    const { exec } = fakeExec(() => ({ stdout: Buffer.alloc(0), stderr: 'No such app', code: 1 }))
    const { fs } = fakeFs({})
    const transport = createSimctlTransport(CONFIG, exec, fs)

    await expect(
      transport.pull({ absolute: false, subpath: 'Documents/x' }, { maxBuffer: 1 }),
    ).rejects.toBeInstanceOf(FileIoError)
  })

  it('maps a spawn-level get_app_container failure (rejection) to a FileIoError', async () => {
    // HostFileExec rejects for spawn failures (xcrun missing / timeout); those
    // must surface as FileIoError, not a raw Node error (REQ-FILES-007).
    const exec: HostFileExec = async () => {
      throw Object.assign(new Error('spawn xcrun ENOENT'), { code: 'ENOENT' })
    }
    const { fs } = fakeFs({})
    const transport = createSimctlTransport(CONFIG, exec, fs)

    await expect(
      transport.pull({ absolute: false, subpath: 'Documents/x' }, { maxBuffer: 1 }),
    ).rejects.toMatchObject({ code: 'TRANSPORT_FAILED' })
  })
})
