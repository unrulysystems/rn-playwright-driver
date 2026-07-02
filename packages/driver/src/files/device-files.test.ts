import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { TargetContext } from '../types'
import { createDeviceFiles, type FileTransport } from './device-files'
import { FileIoError } from './errors'
import { HostFileTooLargeError } from './host-fs'
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

/**
 * Assert a `device.files` call rejects with a TYPED {@link FileIoError} of `code`. The
 * public contract (types.ts / README) promises every failure is a `FileIoError`, not a
 * plain Error/object that merely carries a `code` — a `toMatchObject({ code })` alone
 * would pass on the latter, so this checks `instanceof` too. Fails if the call resolves.
 */
async function expectFileIoError(promise: Promise<unknown>, code: FileIoError['code']) {
  const error = await promise.then(
    () => {
      throw new Error('expected device.files to reject with a FileIoError, but it resolved')
    },
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(FileIoError)
  expect((error as FileIoError).code).toBe(code)
}

describe('createDeviceFiles — lifecycle', () => {
  it('fails closed with UNAVAILABLE once the device is disconnected (isLive false)', async () => {
    // A reference captured before disconnect must not keep doing host-side I/O.
    const { pulls, pushes, select } = fakeTransport()
    const files = createDeviceFiles({
      platform: 'ios',
      target: IOS_TARGET,
      selectTransport: select,
      isLive: () => false,
    })

    await expectFileIoError(files.pull('obs.csv'), 'UNAVAILABLE')
    await expectFileIoError(files.push(Buffer.from('x'), 'seed.bin'), 'UNAVAILABLE')
    expect(select).not.toHaveBeenCalled() // fail closed before any transport
    expect(pulls).toEqual([])
    expect(pushes).toEqual([])
  })

  it('operates normally while the device is live (isLive true)', async () => {
    const { pulls, select } = fakeTransport()
    const files = createDeviceFiles({
      platform: 'ios',
      target: IOS_TARGET,
      selectTransport: select,
      isLive: () => true,
    })

    await files.pull('obs.csv')
    expect(pulls).toHaveLength(1)
  })

  it('fails closed when the connection drops DURING a pull (boundary crossing, not just preflight)', async () => {
    // Live at entry, disconnects mid-read. A preflight-only guard would return the bytes;
    // the post-await re-check must fail closed so no data from a dropped connection leaks.
    let live = true
    const { select } = fakeTransport({
      pull: async () => {
        live = false // disconnect/reconnect races the in-flight read
        return Buffer.from('bytes')
      },
    })
    const files = createDeviceFiles({
      platform: 'ios',
      target: IOS_TARGET,
      selectTransport: select,
      isLive: () => live,
    })
    await expectFileIoError(files.pull('obs.csv'), 'UNAVAILABLE')
  })

  it('fails closed when the connection drops DURING a push (boundary crossing)', async () => {
    let live = true
    const { select } = fakeTransport({
      push: async () => {
        live = false // disconnect races the in-flight write
      },
    })
    const files = createDeviceFiles({
      platform: 'ios',
      target: IOS_TARGET,
      selectTransport: select,
      isLive: () => live,
    })
    await expectFileIoError(files.push(Buffer.from('x'), 'seed.bin'), 'UNAVAILABLE')
  })

  it('PREVENTS the device write when disconnect races host-source materialization', async () => {
    // A string source is stat/read on the host BEFORE the device write. If disconnect
    // lands during that (awaited) window, the pre-write liveness check must stop the write
    // from ever starting — not merely report failure after the bytes already landed.
    let live = true
    const { pushes, select } = fakeTransport()
    const localFileSize = vi.fn(async () => {
      live = false // disconnect races the host stat, before the transport write
      return 4
    })
    const readLocalFileBounded = vi.fn(async () => Buffer.from('data'))
    const files = createDeviceFiles({
      platform: 'ios',
      target: IOS_TARGET,
      selectTransport: select,
      isLive: () => live,
      localFileSize,
      readLocalFileBounded,
    })
    await expectFileIoError(files.push('./src.bin', 'seed.bin'), 'UNAVAILABLE')
    expect(pushes).toEqual([]) // the write was PREVENTED, not just reported failed after
  })
})

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

    await expectFileIoError(files.pull('obs.csv'), 'UNAVAILABLE')
    expect(select).not.toHaveBeenCalled()
  })

  it('rejects UNSUPPORTED for a ".." path before dispatching', async () => {
    const { select } = fakeTransport()
    const files = createDeviceFiles({
      platform: 'ios',
      target: IOS_TARGET,
      selectTransport: select,
    })

    await expectFileIoError(files.pull('../escape'), 'UNSUPPORTED')
    expect(select).not.toHaveBeenCalled()
  })

  it('rejects UNSUPPORTED for the absolute root on iOS — sim and device (REQ-XPORT-007)', async () => {
    // device.files is app-sandbox-scoped; an absolute path on the simulator would
    // be a raw HOST path, so it is rejected on both iOS kinds, never a host escape.
    await Promise.all(
      (['simulator', 'device'] as const).map(async (iosKind) => {
        const { select } = fakeTransport()
        const files = createDeviceFiles({
          platform: 'ios',
          target: { ...IOS_TARGET, iosKind },
          selectTransport: select,
        })

        await expectFileIoError(files.pull('/etc/passwd', { root: 'absolute' }), 'UNSUPPORTED')
        expect(select).not.toHaveBeenCalled() // fail closed before any transport
      }),
    )
  })

  it('rejects a non-finite or non-positive maxBuffer before touching a transport', async () => {
    // NaN/Infinity/0 would make every `size > maxBuffer` check false and silently
    // disable the memory bound — fail closed instead.
    const { select } = fakeTransport()
    const files = createDeviceFiles({
      platform: 'ios',
      target: IOS_TARGET,
      selectTransport: select,
    })

    await Promise.all(
      [Number.NaN, Number.POSITIVE_INFINITY, 0, -1].map((bad) =>
        expectFileIoError(files.pull('obs.csv', { maxBuffer: bad }), 'UNSUPPORTED'),
      ),
    )
    expect(select).not.toHaveBeenCalled()
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

    await expectFileIoError(files.pull('missing.csv'), 'NOT_FOUND')
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

    await expectFileIoError(files.pull('big.bin'), 'TOO_LARGE')
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
    const readLocalFileBounded = vi.fn(async () => Buffer.from('from-disk'))
    const localFileSize = vi.fn(async () => 9)
    const files = createDeviceFiles({
      platform: 'ios',
      target: IOS_TARGET,
      selectTransport: select,
      readLocalFileBounded,
      localFileSize,
    })

    await files.push('./fixtures/seed.json', 'seed.json')

    // Read is bounded by maxBuffer, not an unbounded readFile.
    expect(readLocalFileBounded).toHaveBeenCalledWith('./fixtures/seed.json', expect.any(Number))
    expect(pushes[0]?.data.toString()).toBe('from-disk')
    expect(pushes[0]?.path).toEqual({ absolute: false, subpath: 'Documents/seed.json' })
  })

  it('reads a real host file through the default fs wiring (no injected readers)', async () => {
    // Exercises the default fs.stat (size probe) + fs.readFile path that the
    // README's `push('./fixtures/…')` usage relies on — the other push tests
    // inject fakes and would not catch a default-wiring regression.
    const dir = await mkdtemp(join(tmpdir(), 'rn-driver-df-'))
    try {
      const src = join(dir, 'seed.json')
      await writeFile(src, 'real-disk-bytes')
      const { pushes, select } = fakeTransport()
      const files = createDeviceFiles({
        platform: 'android',
        target: ANDROID_TARGET,
        selectTransport: select,
      })

      await files.push(src, 'seed.json')

      expect(pushes[0]?.data.toString()).toBe('real-disk-bytes')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects TOO_LARGE for a local source over maxBuffer, before reading it', async () => {
    const { pushes, select } = fakeTransport()
    const readLocalFileBounded = vi.fn(async () => Buffer.from('should-not-be-read'))
    const localFileSize = vi.fn(async () => 5_000)
    const files = createDeviceFiles({
      platform: 'android',
      target: ANDROID_TARGET,
      selectTransport: select,
      readLocalFileBounded,
      localFileSize,
    })

    await expectFileIoError(files.push('./big.bin', 'seed.bin', { maxBuffer: 1_000 }), 'TOO_LARGE')
    expect(readLocalFileBounded).not.toHaveBeenCalled() // bounded before the read
    expect(pushes).toEqual([])
  })

  it('rejects TOO_LARGE when a local source grows past the size probe (bounded read)', async () => {
    // The probe passes, but the bounded read detects the file grew over the cap
    // and throws HostFileTooLargeError — push must map that to TOO_LARGE, not leak
    // it or buffer the grown file (REQ-FILES-008), symmetric with pull.
    const { pushes, select } = fakeTransport()
    const localFileSize = vi.fn(async () => 10) // passes the fast-fail
    const readLocalFileBounded = vi.fn(async (_path: string, maxBytes: number) => {
      throw new HostFileTooLargeError(maxBytes)
    })
    const files = createDeviceFiles({
      platform: 'android',
      target: ANDROID_TARGET,
      selectTransport: select,
      readLocalFileBounded,
      localFileSize,
    })

    await expectFileIoError(
      files.push('./grows.bin', 'seed.bin', { maxBuffer: 1_000 }),
      'TOO_LARGE',
    )
    expect(pushes).toEqual([])
  })

  it('rejects TOO_LARGE for a Buffer payload over maxBuffer', async () => {
    const { pushes, select } = fakeTransport()
    const files = createDeviceFiles({
      platform: 'android',
      target: ANDROID_TARGET,
      selectTransport: select,
    })

    await expectFileIoError(
      files.push(Buffer.alloc(2048), 'seed.bin', { maxBuffer: 1024 }),
      'TOO_LARGE',
    )
    expect(pushes).toEqual([])
  })

  it('maps a missing local source (ENOENT) to NOT_FOUND, not a raw Node error', async () => {
    // The public DeviceFiles contract promises every failure is a FileIoError.
    const { select } = fakeTransport()
    // The size probe is what discovers the missing source (it runs first).
    const localFileSize = vi.fn(async () => {
      throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
    })
    const files = createDeviceFiles({
      platform: 'ios',
      target: IOS_TARGET,
      selectTransport: select,
      localFileSize,
    })

    await expectFileIoError(files.push('./missing.json', 'seed.json'), 'NOT_FOUND')
    expect(select).not.toHaveBeenCalled() // fail closed before touching the transport
  })

  it('builds the transport once and reuses it across operations', async () => {
    const { select } = fakeTransport()
    const files = createDeviceFiles({
      platform: 'android',
      target: ANDROID_TARGET,
      selectTransport: select,
    })

    await files.pull('a')
    await files.pull('b')
    await files.push(Buffer.from('x'), 'c')

    expect(select).toHaveBeenCalledTimes(1) // cached per-target, not rebuilt per op
  })

  it('maps other local-source read failures (EACCES) to TRANSPORT_FAILED', async () => {
    const { select } = fakeTransport()
    // Size probe succeeds; the read then fails with EACCES → TRANSPORT_FAILED.
    const localFileSize = vi.fn(async () => 10)
    const readLocalFileBounded = vi.fn(async () => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    })
    const files = createDeviceFiles({
      platform: 'android',
      target: ANDROID_TARGET,
      selectTransport: select,
      readLocalFileBounded,
      localFileSize,
    })

    await expectFileIoError(files.push('./locked.json', 'seed.json'), 'TRANSPORT_FAILED')
  })
})
