import { describe, expect, it, vi } from 'vitest'
import type { TargetContext } from '../types'
import { createDeviceFiles, type FileTransport } from './device-files'
import { FileIoError } from './errors'
import type { ResolvedRemotePath } from './roots'

const IOS_TARGET: TargetContext = { udid: 'UDID-1', bundleId: 'com.acme.app' }
const ANDROID_TARGET: TargetContext = { serial: 'emulator-5554', packageName: 'com.acme.app' }

type PullCall = { path: ResolvedRemotePath; maxBuffer: number }
type PushCall = { path: ResolvedRemotePath; data: Buffer }

function fakeTransport(overrides: Partial<FileTransport> = {}) {
  const pulls: PullCall[] = []
  const pushes: PushCall[] = []
  const transport: FileTransport = {
    pull: async (path, options) => {
      pulls.push({ path, maxBuffer: options.maxBuffer })
      return Buffer.from('bytes')
    },
    push: async (path, data) => {
      pushes.push({ path, data })
    },
    ...overrides,
  }
  const select = vi.fn(() => transport)
  return { pulls, pushes, select }
}

describe('createDeviceFiles — pull', () => {
  it('defaults to the document root + 64 MiB cap and passes the resolved subpath', async () => {
    const { pulls, select } = fakeTransport()
    const files = createDeviceFiles({
      platform: 'ios',
      target: IOS_TARGET,
      selectTransport: select,
    })

    const bytes = await files.pull('obs.csv')

    expect(bytes.toString()).toBe('bytes')
    expect(pulls).toEqual([
      { path: { absolute: false, subpath: 'Documents/obs.csv' }, maxBuffer: 64 * 1024 * 1024 },
    ])
  })

  it('honors an explicit root and maxBuffer', async () => {
    const { pulls, select } = fakeTransport()
    const files = createDeviceFiles({
      platform: 'android',
      target: ANDROID_TARGET,
      selectTransport: select,
    })

    await files.pull('thumb.png', { root: 'cache', maxBuffer: 1024 })

    expect(pulls[0]).toEqual({
      path: { absolute: false, subpath: 'cache/thumb.png' },
      maxBuffer: 1024,
    })
  })

  it('rejects UNAVAILABLE (never touching a transport) when targeting context is missing', async () => {
    const { select } = fakeTransport()
    const files = createDeviceFiles({ platform: 'ios', target: undefined, selectTransport: select })

    await expect(files.pull('obs.csv')).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    expect(select).not.toHaveBeenCalled()
  })

  it('rejects UNSUPPORTED for a ".." path before dispatching', async () => {
    const { select } = fakeTransport()
    const files = createDeviceFiles({
      platform: 'ios',
      target: IOS_TARGET,
      selectTransport: select,
    })

    await expect(files.pull('../escape')).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    expect(select).not.toHaveBeenCalled()
  })

  it('rejects UNSUPPORTED for the absolute root on a physical iOS device (REQ-XPORT-007)', async () => {
    const { select } = fakeTransport()
    const files = createDeviceFiles({
      platform: 'ios',
      target: { ...IOS_TARGET, iosKind: 'device' },
      selectTransport: select,
    })

    await expect(files.pull('/var/x', { root: 'absolute' })).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    })
  })

  it('propagates a transport NOT_FOUND', async () => {
    const { select } = fakeTransport({
      pull: async () => {
        throw new FileIoError('NOT_FOUND', 'no such file')
      },
    })
    const files = createDeviceFiles({
      platform: 'ios',
      target: IOS_TARGET,
      selectTransport: select,
    })

    await expect(files.pull('missing.csv')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('propagates a transport TOO_LARGE', async () => {
    const { select } = fakeTransport({
      pull: async () => {
        throw new FileIoError('TOO_LARGE', 'exceeded cap')
      },
    })
    const files = createDeviceFiles({
      platform: 'android',
      target: ANDROID_TARGET,
      selectTransport: select,
    })

    await expect(files.pull('big.bin')).rejects.toMatchObject({ code: 'TOO_LARGE' })
  })
})

describe('createDeviceFiles — push', () => {
  it('pushes a Buffer verbatim to the resolved subpath', async () => {
    const { pushes, select } = fakeTransport()
    const files = createDeviceFiles({
      platform: 'android',
      target: ANDROID_TARGET,
      selectTransport: select,
    })
    const data = Buffer.from([1, 2, 3])

    await files.push(data, 'seed.json')

    expect(pushes).toEqual([{ path: { absolute: false, subpath: 'files/seed.json' }, data }])
  })

  it('reads a local file path and pushes its bytes', async () => {
    const { pushes, select } = fakeTransport()
    const readLocalFile = vi.fn(async () => Buffer.from('from-disk'))
    const files = createDeviceFiles({
      platform: 'ios',
      target: IOS_TARGET,
      selectTransport: select,
      readLocalFile,
    })

    await files.push('./fixtures/seed.json', 'seed.json')

    expect(readLocalFile).toHaveBeenCalledWith('./fixtures/seed.json')
    expect(pushes[0]?.data.toString()).toBe('from-disk')
    expect(pushes[0]?.path).toEqual({ absolute: false, subpath: 'Documents/seed.json' })
  })
})
