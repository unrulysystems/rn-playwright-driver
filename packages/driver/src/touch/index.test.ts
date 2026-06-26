import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type TouchBackendContext, TouchBackendUnavailableError } from './backend'
import { type AdbExec, CliTouchBackend } from './cli-backend'
import { createTouchBackend } from './index'
import { XCTestTouchBackend } from './xctest-backend'

function createContext(hasNativeModule: boolean, platform: 'ios' | 'android'): TouchBackendContext {
  const evaluateMock = vi.fn((_expression: string) => hasNativeModule)
  return {
    platform,
    evaluate: async <T>(expression: string): Promise<T> => evaluateMock(expression) as T,
    waitForTimeout: vi.fn(),
  }
}

function okResponse(data: unknown = { ok: true }): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as Response
}

describe('createTouchBackend', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse()) as typeof fetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('selects the XCTest backend by default on iOS', async () => {
    const xctestInit = vi
      .spyOn(XCTestTouchBackend.prototype, 'init')
      .mockResolvedValueOnce(undefined)

    const result = await createTouchBackend(createContext(true, 'ios'))

    expect(result.backend.name).toBe('xctest')
    expect(result.selection).toEqual({
      backend: 'xctest',
      available: ['xctest'],
    })
    expect(result.attempted).toEqual([])
    expect(xctestInit).toHaveBeenCalledTimes(1)
  })

  it('selects the instrumentation backend by default on Android when auth is configured', async () => {
    const cliInit = vi.spyOn(CliTouchBackend.prototype, 'init').mockResolvedValueOnce(undefined)
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      expect(init?.headers).toMatchObject({ 'x-rn-driver-auth': 'test-token' })
      return okResponse()
    })

    const result = await createTouchBackend(createContext(true, 'android'), {
      instrumentation: { authToken: 'test-token' },
    })

    expect(result.backend.name).toBe('instrumentation')
    expect(result.selection).toEqual({
      backend: 'instrumentation',
      available: ['instrumentation'],
    })
    expect(result.attempted).toEqual([])
    expect(cliInit).not.toHaveBeenCalled()
  })

  it('skips unsupported backends and selects the next platform-compatible backend', async () => {
    const result = await createTouchBackend(createContext(true, 'android'), {
      order: ['xctest', 'native-module'],
    })

    expect(result.backend.name).toBe('native-module')
    expect(result.selection.available).toEqual(['native-module'])
    expect(result.attempted).toEqual([])
  })

  it('does not select the cli backend on iOS', async () => {
    const xctestInit = vi
      .spyOn(XCTestTouchBackend.prototype, 'init')
      .mockResolvedValueOnce(undefined)
    const cliInit = vi.spyOn(CliTouchBackend.prototype, 'init').mockResolvedValueOnce(undefined)

    const result = await createTouchBackend(createContext(true, 'ios'), {
      order: ['cli', 'xctest'],
    })

    expect(result.backend.name).toBe('xctest')
    expect(result.selection.available).toEqual(['xctest'])
    expect(cliInit).not.toHaveBeenCalled()
    expect(xctestInit).toHaveBeenCalledTimes(1)
  })

  it('falls back to instrumentation after native module initialization fails', async () => {
    const result = await createTouchBackend(createContext(false, 'android'), {
      order: ['native-module', 'instrumentation'],
      instrumentation: { host: '10.0.2.2', port: 4545 },
    })

    expect(result.backend.name).toBe('instrumentation')
    expect(result.selection).toEqual({
      backend: 'instrumentation',
      available: ['native-module', 'instrumentation'],
      reason: 'Selected after 1 failed attempts',
    })
    expect(result.attempted).toHaveLength(1)
    expect(result.attempted[0]).toMatchObject({
      backend: 'native-module',
      error: expect.any(TouchBackendUnavailableError),
    })
    expect(fetch).toHaveBeenCalledWith(
      'http://10.0.2.2:4545/command',
      expect.objectContaining({ body: JSON.stringify({ type: 'hello' }) }),
    )
  })

  it('keeps native-module reachable on Android via force mode', async () => {
    const result = await createTouchBackend(createContext(true, 'android'), {
      mode: 'force',
      backend: 'native-module',
    })

    expect(result.backend.name).toBe('native-module')
    expect(result.selection.available).toEqual(['native-module'])
  })

  it('keeps native-module reachable on Android via explicit order', async () => {
    const result = await createTouchBackend(createContext(true, 'android'), {
      order: ['native-module'],
    })

    expect(result.backend.name).toBe('native-module')
    expect(result.selection.available).toEqual(['native-module'])
  })

  it('does not fall back when force mode backend initialization fails', async () => {
    await expect(
      createTouchBackend(createContext(false, 'ios'), {
        mode: 'force',
        backend: 'native-module',
      }),
    ).rejects.toMatchObject({
      backend: 'native-module',
      message: expect.stringContaining('RNDriverTouchInjector native module not found'),
    })
  })

  it('throws an actionable summary when no enabled backend is available', async () => {
    await expect(
      createTouchBackend(createContext(false, 'ios'), {
        order: ['native-module', 'instrumentation', 'cli'],
      }),
    ).rejects.toMatchObject({
      backend: 'native-module',
      message: expect.stringContaining('No touch backend available. Attempts:'),
    })

    await expect(
      createTouchBackend(createContext(false, 'ios'), {
        nativeModule: { enabled: false },
        xctest: { enabled: false },
        cli: { enabled: false },
      }),
    ).rejects.toMatchObject({
      backend: 'xctest',
      message:
        'No touch backend available. Start the platform touch companion or configure an explicit lower-fidelity backend.',
    })
  })
})

describe('CliTouchBackend', () => {
  it('init() rejects with TouchBackendUnavailableError when adb is unreachable (enables fallback)', async () => {
    const adbExec = vi.fn<AdbExec>(async () => {
      throw new Error('adb unavailable')
    })
    const backend = new CliTouchBackend(
      createContext(false, 'android'),
      {
        adbPath: '/custom/adb',
        serial: 'emulator-5554',
      },
      {
        exec: adbExec,
      },
    )

    let error: unknown
    try {
      await backend.init()
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(TouchBackendUnavailableError)
    expect(error).toMatchObject({
      backend: 'cli',
      message: expect.stringContaining('adb get-state failed'),
    })
    expect(adbExec).toHaveBeenCalledWith(['-s', 'emulator-5554', 'get-state'])
  })
})
