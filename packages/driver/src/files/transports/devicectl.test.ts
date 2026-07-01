import { describe, expect, it } from 'vitest'
import type { HostExecResult, HostFileExec } from '../host-file-exec'
import type { HostFs } from '../host-fs'
import { createDevicectlTransport } from './devicectl'

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

function fakeFs(files: Record<string, string> = {}) {
  const removed: string[] = []
  const written: [string, Buffer][] = []
  const fs: HostFs = {
    readFile: async (path) => {
      if (path in files) return Buffer.from(files[path] as string)
      if (path.endsWith('payload')) return Buffer.from('DATA')
      throw Object.assign(new Error('enoent'), { code: 'ENOENT' })
    },
    writeFile: async (path, data) => {
      written.push([path, data])
    },
    mkdtempDir: async () => '/tmp/dc',
    remove: async (path) => {
      removed.push(path)
    },
  }
  return { fs, removed, written }
}

const ok = (): HostExecResult => ({ stdout: Buffer.alloc(0), stderr: '', code: 0 })

describe('devicectl transport (provisional, REQ-XPORT-003)', () => {
  it('copies FROM the container to a host temp then reads it', async () => {
    const { exec, calls } = fakeExec(ok)
    const { fs, removed } = fakeFs()
    const transport = createDevicectlTransport(CONFIG, exec, fs)

    const bytes = await transport.pull(
      { absolute: false, subpath: 'Documents/obs.csv' },
      { maxBuffer: 1 },
    )

    expect(calls[0]).toEqual({
      command: 'xcrun',
      args: [
        'devicectl',
        'device',
        'copy',
        'from',
        '--device',
        'UDID-1',
        '--domain-type',
        'appDataContainer',
        '--domain-identifier',
        'com.acme.app',
        '--source',
        'Documents/obs.csv',
        '--destination',
        '/tmp/dc/payload',
        '--json-output',
        '/tmp/dc/result.json',
      ],
    })
    expect(bytes.toString()).toBe('DATA')
    expect(removed).toEqual(['/tmp/dc']) // temp dir always cleaned up
  })

  it('copies TO the container from a staged host temp on push', async () => {
    const { exec, calls } = fakeExec(ok)
    const { fs, written } = fakeFs()
    const transport = createDevicectlTransport(CONFIG, exec, fs)

    await transport.push({ absolute: false, subpath: 'Documents/seed.json' }, Buffer.from('x'))

    expect(written[0]?.[0]).toBe('/tmp/dc/payload')
    expect(calls[0]?.args).toEqual([
      'devicectl',
      'device',
      'copy',
      'to',
      '--device',
      'UDID-1',
      '--domain-type',
      'appDataContainer',
      '--domain-identifier',
      'com.acme.app',
      '--source',
      '/tmp/dc/payload',
      '--destination',
      'Documents/seed.json',
      '--json-output',
      '/tmp/dc/result.json',
    ])
  })

  it('classifies a missing source as NOT_FOUND', async () => {
    const { exec } = fakeExec(() => ({
      stdout: Buffer.alloc(0),
      stderr: 'The requested file does not exist.',
      code: 1,
    }))
    const { fs } = fakeFs()
    await expect(
      createDevicectlTransport(CONFIG, exec, fs).pull(
        { absolute: false, subpath: 'Documents/x' },
        { maxBuffer: 1 },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects the absolute root as UNSUPPORTED (container-scoped)', async () => {
    const { exec, calls } = fakeExec(ok)
    const { fs } = fakeFs()
    await expect(
      createDevicectlTransport(CONFIG, exec, fs).pull(
        { absolute: true, path: '/var/x' },
        { maxBuffer: 1 },
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    expect(calls).toHaveLength(0)
  })
})
