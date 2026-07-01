import { describe, expect, it } from 'vitest'
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
    // Identity realpath by default: no symlinks, so every joined path resolves
    // to itself and the container-containment check passes.
    realpath: async (path) => path,
    // Default size 0 keeps the pull memory bound a no-op for the behavioral
    // tests; the dedicated size-guard test overrides it to trip TOO_LARGE.
    size: async () => 0,
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
      { maxBuffer: 4096 },
    )

    expect(calls[0]).toEqual({
      command: 'xcrun',
      args: ['simctl', 'get_app_container', 'UDID-1', 'com.acme.app', 'data'],
    })
    expect(reads).toEqual(['/sim/Containers/Data/App/ABC/Documents/obs.csv'])
    expect(bytes.toString()).toBe('@/sim/Containers/Data/App/ABC/Documents/obs.csv')
  })

  it('rejects TOO_LARGE when the sandbox file exceeds maxBuffer, before reading it', async () => {
    const { exec } = fakeExec(() => ok('/sim/ABC'))
    const { fs, reads } = fakeFs({ size: async () => 5_000 })

    await expect(
      createSimctlTransport(CONFIG, exec, fs).pull(
        { absolute: false, subpath: 'Documents/big.bin' },
        { maxBuffer: 1_000 },
      ),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' })
    expect(reads).toEqual([]) // bounded before the read
  })

  it('maps a vanished app container to TRANSPORT_FAILED, not NOT_FOUND', async () => {
    // The container realpath (not the requested file) fails, so this is a
    // transport/environment failure — mislabeling it NOT_FOUND would tell the
    // caller the remote file is missing.
    const { exec } = fakeExec(() => ok('/sim/ABC'))
    const { fs } = fakeFs({
      realpath: async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      },
    })

    await expect(
      createSimctlTransport(CONFIG, exec, fs).pull(
        { absolute: false, subpath: 'Documents/x' },
        { maxBuffer: 10 },
      ),
    ).rejects.toMatchObject({ code: 'TRANSPORT_FAILED' })
  })

  it('writes to the joined host path on push', async () => {
    const { exec } = fakeExec(() => ok('/sim/ABC'))
    const { fs, writes } = fakeFs({})
    const transport = createSimctlTransport(CONFIG, exec, fs)

    await transport.push({ absolute: false, subpath: 'Documents/seed.json' }, Buffer.from('x'))

    expect(writes[0]?.[0]).toBe('/sim/ABC/Documents/seed.json')
  })

  it('rejects UNSUPPORTED when an in-container symlink resolves outside on pull (host escape)', async () => {
    const { exec } = fakeExec(() => ok('/sim/ABC'))
    // Documents/evil is a symlink whose target escapes the container.
    const { fs, reads } = fakeFs({
      realpath: async (path) => (path === '/sim/ABC/Documents/evil' ? '/etc/passwd' : path),
    })

    await expect(
      createSimctlTransport(CONFIG, exec, fs).pull(
        { absolute: false, subpath: 'Documents/evil' },
        { maxBuffer: 1 },
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    expect(reads).toEqual([]) // never dereferenced — fail closed before the read
  })

  it('rejects UNSUPPORTED when a parent symlink escapes the container on push', async () => {
    const { exec } = fakeExec(() => ok('/sim/ABC'))
    // Documents/link -> /outside; the not-yet-created tail ENOENTs, so the check
    // walks up to the escaping parent and rejects before writing.
    const { fs, writes } = fakeFs({
      realpath: async (path) => {
        if (path === '/sim/ABC/Documents/link/file.bin') {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        }
        return path === '/sim/ABC/Documents/link' ? '/outside' : path
      },
    })

    await expect(
      createSimctlTransport(CONFIG, exec, fs).push(
        { absolute: false, subpath: 'Documents/link/file.bin' },
        Buffer.from('x'),
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    expect(writes).toEqual([]) // fail closed before the write
  })

  it('allows a nested push whose tail does not exist yet (walks up to an in-container ancestor)', async () => {
    const { exec } = fakeExec(() => ok('/sim/ABC'))
    // The tail ENOENTs; the existing ancestor (Documents) is inside the container.
    const { fs, writes } = fakeFs({
      realpath: async (path) => {
        if (path === '/sim/ABC/Documents/new/file.bin') {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        }
        return path
      },
    })

    await createSimctlTransport(CONFIG, exec, fs).push(
      { absolute: false, subpath: 'Documents/new/file.bin' },
      Buffer.from('x'),
    )

    expect(writes[0]?.[0]).toBe('/sim/ABC/Documents/new/file.bin')
  })

  it('writes a nested push path verbatim (HostFs creates the parents) (REQ-FILES-006)', async () => {
    const { exec } = fakeExec(() => ok('/sim/ABC'))
    const { fs, writes } = fakeFs({})

    await createSimctlTransport(CONFIG, exec, fs).push(
      { absolute: false, subpath: 'Documents/exports/2026/obs.csv' },
      Buffer.from('x'),
    )

    expect(writes[0]?.[0]).toBe('/sim/ABC/Documents/exports/2026/obs.csv')
  })

  it('resolves the app container once and reuses it across operations', async () => {
    const { exec, calls } = fakeExec(() => ok('/sim/ABC'))
    const { fs } = fakeFs({})
    const transport = createSimctlTransport(CONFIG, exec, fs)

    await transport.pull({ absolute: false, subpath: 'Documents/a' }, { maxBuffer: 4096 })
    await transport.pull({ absolute: false, subpath: 'Documents/b' }, { maxBuffer: 4096 })
    await transport.push({ absolute: false, subpath: 'Documents/c' }, Buffer.from('x'))

    const containerCalls = calls.filter((c) => c.args.includes('get_app_container'))
    expect(containerCalls).toHaveLength(1) // cached after the first resolve
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
    ).rejects.toMatchObject({ code: 'TRANSPORT_FAILED' })
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
