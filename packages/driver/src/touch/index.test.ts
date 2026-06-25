import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type TouchBackendContext, TouchBackendUnavailableError } from './backend'
import { CliTouchBackend } from './cli-backend'
import { createTouchBackend } from './index'

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

const originalFetch = globalThis.fetch

describe('createTouchBackend', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => okResponse()) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('selects the native module backend by default when the app exposes the capability', async () => {
    const result = await createTouchBackend(createContext(true, 'ios'))

    expect(result.backend.name).toBe('native-module')
    expect(result.selection).toEqual({
      backend: 'native-module',
      available: ['native-module'],
    })
    expect(result.attempted).toEqual([])
  })

  it('uses instrumentation then cli as the Android auto order', async () => {
    const fetchMock = globalThis.fetch as unknown as {
      mockRejectedValueOnce(value: unknown): void
    }
    fetchMock.mockRejectedValueOnce(new Error('companion absent'))
    const cliInit = vi.spyOn(CliTouchBackend.prototype, 'init').mockResolvedValueOnce(undefined)

    const result = await createTouchBackend(createContext(false, 'android'))

    expect(result.backend.name).toBe('cli')
    expect(result.selection).toEqual({
      backend: 'cli',
      available: ['instrumentation', 'cli'],
      reason: 'Selected after 1 failed attempts',
    })
    expect(result.attempted).toHaveLength(1)
    expect(result.attempted[0]).toMatchObject({
      backend: 'instrumentation',
      error: expect.any(TouchBackendUnavailableError),
    })
    expect(cliInit).toHaveBeenCalledTimes(1)
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
    const cliInit = vi.spyOn(CliTouchBackend.prototype, 'init').mockResolvedValueOnce(undefined)

    const result = await createTouchBackend(createContext(true, 'ios'), {
      order: ['cli', 'native-module'],
    })

    expect(result.backend.name).toBe('native-module')
    expect(result.selection.available).toEqual(['native-module'])
    expect(cliInit).not.toHaveBeenCalled()
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
      backend: 'native-module',
      message:
        'No touch backend available. Install @unrulysystems/rn-driver-touch or configure XCTest/Instrumentation.',
    })
  })
})

describe('CliTouchBackend', () => {
  it('preserves the wontfix not-implemented error', async () => {
    const backend = new CliTouchBackend(createContext(false, 'android'), {
      adbPath: '/custom/adb',
      serial: 'emulator-5554',
    })

    await expect(backend.init()).rejects.toMatchObject({
      backend: 'cli',
      message: expect.stringContaining('CLI touch backend not implemented yet'),
    })
    await expect(backend.tap(1, 2)).rejects.toMatchObject({
      backend: 'cli',
      message: 'CLI touch backend not available.',
    })
  })
})
