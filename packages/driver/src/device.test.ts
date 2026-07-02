/**
 * Tests for RNDevice core primitives.
 * These tests verify the device-level API behavior by mocking the CDP layer.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as discovery from './cdp/discovery'
import { RNDevice, TimeoutError, UncaughtExceptionError } from './device'
import { createTouchBackend } from './touch'
import type { ConsoleMessage, PageError } from './types'

type MockTarget = {
  id: string
  title: string
  webSocketDebuggerUrl: string
  deviceName?: string
}

// Store mock evaluate + onEvent + connect for tests to access
let mockEvaluateFn: ReturnType<typeof vi.fn>
let mockOnEventFn: ReturnType<typeof vi.fn>
let mockConnectFn: ReturnType<typeof vi.fn>
let mockSelectedTarget: MockTarget

function defaultTarget(): MockTarget {
  return {
    id: 'test-target',
    title: 'Test App',
    webSocketDebuggerUrl: 'ws://localhost:8081/debugger',
  }
}

function isPlatformProbe(expr: string): boolean {
  return expr.includes('Platform') && expr.includes('OS')
}

function mockDefaultPlatform(platform: 'ios' | 'android' = 'ios'): void {
  mockEvaluateFn.mockImplementation((expr: string) => {
    if (isPlatformProbe(expr)) {
      return Promise.resolve(platform)
    }
    return Promise.resolve(undefined)
  })
}

// Mock the CDP client with a class
vi.mock('./cdp/client', () => {
  return {
    CDPClient: class MockCDPClient {
      evaluate = vi.fn()
      connect = vi.fn()
      disconnect = vi.fn()
      ping = vi.fn().mockResolvedValue(true)
      onEvent = vi.fn().mockReturnValue(() => undefined)

      constructor() {
        mockEvaluateFn = this.evaluate
        mockOnEventFn = this.onEvent
        mockConnectFn = this.connect
      }
    },
  }
})

/** Invoke the device's registered CDP forwarder for `method` with `params`. */
function fireCdpEvent(method: string, params: Record<string, unknown>): void {
  const call = mockOnEventFn.mock.calls.find((c) => c[0] === method)
  if (!call) {
    throw new Error(`no onEvent forwarder registered for ${method}`)
  }
  ;(call[1] as (p: Record<string, unknown>) => void)(params)
}

// Mock CDP discovery. Spread the REAL module so pure helpers detectPlatform relies
// on (titleParenthetical) stay authentic — only the network/selection entry points
// are stubbed. A hand-reimplemented helper would silently drift from the source.
vi.mock('./cdp/discovery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./cdp/discovery')>()
  return {
    ...actual,
    discoverTargets: vi.fn().mockImplementation(() => Promise.resolve([mockSelectedTarget])),
    selectTarget: vi.fn().mockImplementation(() => mockSelectedTarget),
    selectTargetForConnect: vi.fn().mockImplementation(() => mockSelectedTarget),
  }
})

// Mock touch backend
vi.mock('./touch', () => ({
  // A FRESH backend per call so a reconnect's dispose can be attributed to the
  // specific (old) backend it should tear down, not a shared singleton spy.
  createTouchBackend: vi.fn().mockImplementation(() =>
    Promise.resolve({
      backend: {
        tap: vi.fn(),
        down: vi.fn(),
        move: vi.fn(),
        up: vi.fn(),
        dispose: vi.fn(),
      },
      selection: {
        backend: 'native-module',
        available: ['native-module'],
      },
    }),
  ),
}))

/** Route the mocked CDP evaluate so getWindowMetrics() resolves to `metrics`. */
function mockWindowMetrics(metrics: unknown): void {
  mockEvaluateFn.mockImplementation((expr: string) => {
    if (expr.includes('getWindowMetrics')) {
      return Promise.resolve(metrics)
    }
    return Promise.resolve(undefined)
  })
}

describe('RNDevice Core Primitives', () => {
  let device: RNDevice

  beforeEach(async () => {
    vi.clearAllMocks()
    mockSelectedTarget = defaultTarget()

    device = new RNDevice({ timeout: 1000 })

    // Default mock for platform detection
    mockDefaultPlatform('ios')

    await device.connect()
  })

  describe('connect() target selection wiring', () => {
    it('routes target selection through selectTargetForConnect, forwarding the pinned target', async () => {
      // The confused-deputy guard lives in selectTargetForConnect; connect() must
      // hand it DeviceOptions.target so filePinned is derived from udid/serial.
      // (Guard behavior itself is unit-tested in cdp/discovery.test.ts.)
      vi.clearAllMocks()
      // Construct FIRST so mockEvaluateFn points at this device's CDP client,
      // THEN set the platform probe impl (mirrors connectWithPlatformProbe).
      const pinned = new RNDevice({ timeout: 1000, target: { udid: 'UDID-42' } })
      mockDefaultPlatform('ios')
      await pinned.connect()

      expect(discovery.selectTargetForConnect).toHaveBeenCalledTimes(1)
      const options = vi.mocked(discovery.selectTargetForConnect).mock.calls[0]?.[1]
      expect(options?.target).toEqual({ udid: 'UDID-42' })
    })
  })

  describe('platform detection', () => {
    async function connectWithPlatformProbe(
      target: MockTarget,
      probe: () => Promise<unknown>,
    ): Promise<RNDevice> {
      vi.clearAllMocks()
      mockSelectedTarget = target
      const platformDevice = new RNDevice({ timeout: 1000 })
      mockEvaluateFn.mockImplementation((expr: string) => {
        if (isPlatformProbe(expr)) {
          return probe()
        }
        return Promise.resolve(undefined)
      })

      await platformDevice.connect()
      return platformDevice
    }

    it('detects Android from a structured deviceName (fast-path, no probe)', async () => {
      const platformDevice = await connectWithPlatformProbe(
        { ...defaultTarget(), deviceName: 'Pixel_8_API_35' },
        () => Promise.reject(new Error('probe should not run')),
      )

      expect(platformDevice.platform).toBe('android')
    })

    it('detects Android from generic emulator device metadata', async () => {
      const platformDevice = await connectWithPlatformProbe(
        {
          ...defaultTarget(),
          deviceName: 'sdk_gphone64_arm64 - 15 - API 35',
        },
        () => Promise.reject(new Error('probe should not run')),
      )

      expect(platformDevice.platform).toBe('android')
    })

    it('detects iOS from a structured deviceName (fast-path, no probe)', async () => {
      const platformDevice = await connectWithPlatformProbe(
        { ...defaultTarget(), deviceName: 'iPhone 16 Pro' },
        () => Promise.reject(new Error('probe should not run')),
      )

      expect(platformDevice.platform).toBe('ios')
    })

    it('reads the device from a title parenthetical, not the app id ahead of it', async () => {
      // Metro titles are `appId (deviceName)`. Only the trailing `(…)` device is used
      // for the fast-path, so `com.acme.iosapp` never wins the iOS check.
      const platformDevice = await connectWithPlatformProbe(
        { ...defaultTarget(), title: 'com.acme.iosapp (Pixel_8_API_35)' },
        () => Promise.reject(new Error('probe should not run — parenthetical resolves Android')),
      )

      expect(platformDevice.platform).toBe('android')
    })

    it('defers a BARE app-id title to Platform.OS (never guesses platform from an app id)', async () => {
      // No deviceName, no parenthetical — a bare `com.acme.iosapp` is ambiguous and
      // must NOT be matched on the `ios` substring; the authoritative probe decides.
      const platformDevice = await connectWithPlatformProbe(
        { ...defaultTarget(), title: 'com.acme.iosapp' },
        () => Promise.resolve('android'),
      )

      expect(platformDevice.platform).toBe('android')
    })

    it('fails closed when a bare title carries no device identity and the probe fails', async () => {
      await expect(
        connectWithPlatformProbe({ ...defaultTarget(), title: 'com.acme.iosapp' }, () =>
          Promise.reject(new Error('runtime not ready')),
        ),
      ).rejects.toThrow(/Could not detect platform/)
    })

    it('uses Platform.OS when target name metadata is unknown', async () => {
      const platformDevice = await connectWithPlatformProbe(defaultTarget(), () =>
        Promise.resolve('android'),
      )

      expect(platformDevice.platform).toBe('android')
    })

    it('throws when target name metadata is unknown and Platform.OS probe fails', async () => {
      vi.clearAllMocks()
      mockSelectedTarget = defaultTarget()
      const platformDevice = new RNDevice({ timeout: 1000 })
      mockEvaluateFn.mockImplementation((expr: string) => {
        if (isPlatformProbe(expr)) {
          return Promise.reject(new Error('runtime unavailable'))
        }
        return Promise.resolve(undefined)
      })

      await expect(platformDevice.connect()).rejects.toThrow(
        'Could not detect platform: CDP target carried no device identity and the Platform.OS probe failed',
      )
    })

    it('throws when target name metadata is unknown and Platform.OS is unsupported', async () => {
      vi.clearAllMocks()
      mockSelectedTarget = defaultTarget()
      const platformDevice = new RNDevice({ timeout: 1000 })
      mockEvaluateFn.mockImplementation((expr: string) => {
        if (isPlatformProbe(expr)) {
          return Promise.resolve('web')
        }
        return Promise.resolve(undefined)
      })

      await expect(platformDevice.connect()).rejects.toThrow(
        'Could not detect platform: CDP target carried no device identity and Platform.OS returned an unsupported value',
      )
    })
  })

  describe('getWindowMetrics', () => {
    it('should call harness getWindowMetrics and return result', async () => {
      const mockMetrics = {
        width: 390,
        height: 844,
        pixelRatio: 3,
        scale: 3,
        fontScale: 1,
        orientation: 'portrait' as const,
      }

      mockWindowMetrics(mockMetrics)

      const metrics = await device.getWindowMetrics()

      expect(metrics).toEqual(mockMetrics)
      expect(mockEvaluateFn).toHaveBeenCalledWith('globalThis.__RN_DRIVER__.getWindowMetrics()')
    })
  })

  describe('scroll', () => {
    it('queries window metrics and swipes the finger up to scroll content down', async () => {
      mockWindowMetrics({
        width: 400,
        height: 800,
        pixelRatio: 2,
        scale: 2,
        fontScale: 1,
        orientation: 'portrait' as const,
      })
      const swipeSpy = vi.spyOn(device.pointer, 'swipe').mockResolvedValue(undefined)

      await device.scroll({ dy: 200 })

      expect(mockEvaluateFn).toHaveBeenCalledWith('globalThis.__RN_DRIVER__.getWindowMetrics()')
      expect(swipeSpy).toHaveBeenCalledTimes(1)
      const arg = swipeSpy.mock.calls[0]?.[0]
      if (!arg) {
        throw new Error('expected pointer.swipe to have been called')
      }
      // dy > 0 (scroll down) drags the finger upward.
      expect(arg.to.y).toBeLessThan(arg.from.y)
    })
  })

  describe('waitForStable', () => {
    it('polls the sample until it stabilizes', async () => {
      const values = [1, 2, 2]
      let i = 0
      await device.waitForStable(async () => values[i++], { pollInterval: 0 })
      expect(i).toBe(3)
    })

    it('stops when the sample returns undefined', async () => {
      let calls = 0
      await device.waitForStable(
        async () => {
          calls++
          return undefined
        },
        { pollInterval: 0 },
      )
      expect(calls).toBe(1)
    })
  })

  describe('getFrameCount', () => {
    it('should call harness getFrameCount and return result', async () => {
      mockEvaluateFn.mockImplementation((expr: string) => {
        if (expr.includes('getFrameCount')) {
          return Promise.resolve(42)
        }
        return Promise.resolve(undefined)
      })

      const count = await device.getFrameCount()

      expect(count).toBe(42)
      expect(mockEvaluateFn).toHaveBeenCalledWith('globalThis.__RN_DRIVER__.getFrameCount()')
    })
  })

  describe('waitForRaf', () => {
    it('should wait for specified number of frames', async () => {
      let frameCount = 10

      mockEvaluateFn.mockImplementation((expr: string) => {
        if (expr.includes('getFrameCount')) {
          // Simulate frames advancing each call
          frameCount += 1
          return Promise.resolve(frameCount)
        }
        return Promise.resolve(undefined)
      })

      await device.waitForRaf(2)

      // Should have called getFrameCount multiple times
      const frameCountCalls = mockEvaluateFn.mock.calls.filter((call) =>
        call[0].includes('getFrameCount'),
      )
      expect(frameCountCalls.length).toBeGreaterThanOrEqual(2)
    })

    it('should default to waiting for 1 frame', async () => {
      let frameCount = 5

      mockEvaluateFn.mockImplementation((expr: string) => {
        if (expr.includes('getFrameCount')) {
          frameCount += 1
          return Promise.resolve(frameCount)
        }
        return Promise.resolve(undefined)
      })

      await device.waitForRaf()

      const frameCountCalls = mockEvaluateFn.mock.calls.filter((call) =>
        call[0].includes('getFrameCount'),
      )
      expect(frameCountCalls.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('waitForFrameCount', () => {
    it('should resolve when frame count reaches target', async () => {
      let frameCount = 10

      mockEvaluateFn.mockImplementation((expr: string) => {
        if (expr.includes('getFrameCount')) {
          frameCount += 5
          return Promise.resolve(frameCount)
        }
        return Promise.resolve(undefined)
      })

      await device.waitForFrameCount(15)

      // Should have resolved without error
    })

    it('should timeout if frame count never reaches target', async () => {
      // Frame count stays at 0
      mockEvaluateFn.mockImplementation((expr: string) => {
        if (expr.includes('getFrameCount')) {
          return Promise.resolve(0)
        }
        return Promise.resolve(undefined)
      })

      await expect(device.waitForFrameCount(100)).rejects.toThrow(TimeoutError)
    })
  })

  describe('getTouchBackendInfo', () => {
    it('should return touch backend info after connect', async () => {
      const info = await device.getTouchBackendInfo()

      expect(info).toEqual({
        selected: 'native-module',
        available: ['native-module'],
      })
    })

    it('should throw if not connected', async () => {
      const disconnectedDevice = new RNDevice()

      await expect(disconnectedDevice.getTouchBackendInfo()).rejects.toThrow('Device not connected')
    })
  })

  describe('startTracing', () => {
    it('should call harness startTracing with no options', async () => {
      mockEvaluateFn.mockResolvedValue(undefined)

      await device.startTracing()

      expect(mockEvaluateFn).toHaveBeenCalledWith('globalThis.__RN_DRIVER__.startTracing({})')
    })

    it('should call harness startTracing with options', async () => {
      mockEvaluateFn.mockResolvedValue(undefined)

      await device.startTracing({ includeConsole: true })

      expect(mockEvaluateFn).toHaveBeenCalledWith(
        'globalThis.__RN_DRIVER__.startTracing({"includeConsole":true})',
      )
    })
  })

  describe('stopTracing', () => {
    it('should call harness stopTracing and return events', async () => {
      const mockEvents = {
        events: [
          { type: 'pointer:tap', timestamp: 1000, data: { x: 100, y: 200 } },
          { type: 'evaluate', timestamp: 1001, data: { expression: 'test' } },
        ],
      }

      mockEvaluateFn.mockImplementation((expr: string) => {
        if (expr.includes('stopTracing')) {
          return Promise.resolve(mockEvents)
        }
        return Promise.resolve(undefined)
      })

      const result = await device.stopTracing()

      expect(result).toEqual(mockEvents)
      expect(mockEvaluateFn).toHaveBeenCalledWith('globalThis.__RN_DRIVER__.stopTracing()')
    })
  })

  describe('evaluate tracing', () => {
    it('should trace evaluate calls when tracing is active', async () => {
      mockEvaluateFn.mockResolvedValue('test-result')

      await device.evaluate('someExpression()')

      // Should have called evaluate twice: once for the expression, once for tracing
      expect(mockEvaluateFn).toHaveBeenCalledWith('someExpression()')
      expect(mockEvaluateFn).toHaveBeenCalledWith(expect.stringContaining('traceEvent'))
    })

    it('should not trace startTracing/stopTracing calls', async () => {
      // Clear previous calls from setup
      mockEvaluateFn.mockClear()
      mockEvaluateFn.mockResolvedValue(undefined)

      await device.evaluate('globalThis.__RN_DRIVER__.startTracing()')

      // Should only have called evaluate once (no tracing injection)
      const traceCalls = mockEvaluateFn.mock.calls.filter((call) => call[0].includes('traceEvent'))
      expect(traceCalls).toHaveLength(0)
    })
  })
})

describe('RNDevice runtime events', () => {
  let device: RNDevice

  beforeEach(async () => {
    vi.clearAllMocks()
    mockSelectedTarget = defaultTarget()
    device = new RNDevice({ timeout: 1000 })
    mockDefaultPlatform('ios')
    await device.connect()
  })

  it('registers runtime event forwarders before connecting (closes the connect-window gap)', () => {
    // beforeEach already drove device.connect(). The forwarders (onEvent) must be
    // subscribed BEFORE cdp.connect() — which sends Runtime.enable — or any event
    // the runtime emits in that window is delivered with no handler and dropped.
    // See client-connect-window.test.ts for the mechanism proof. invocationCallOrder
    // is a global monotonic counter, so a lower value means "called earlier".
    expect(mockConnectFn.mock.invocationCallOrder.length).toBeGreaterThan(0)
    expect(mockOnEventFn.mock.invocationCallOrder.length).toBeGreaterThan(0)
    const connectOrder = mockConnectFn.mock.invocationCallOrder[0] as number
    const firstForwarderOrder = Math.min(...mockOnEventFn.mock.invocationCallOrder)
    expect(firstForwarderOrder).toBeLessThan(connectOrder)
  })

  it('forwards console events to on("console") listeners as parsed messages', () => {
    const seen: ConsoleMessage[] = []
    device.on('console', (m) => seen.push(m))

    fireCdpEvent('Runtime.consoleAPICalled', {
      type: 'warning',
      args: [{ value: 'hello' }, { value: 7 }],
      timestamp: 5,
    })

    expect(seen).toEqual([{ type: 'warning', text: 'hello 7', args: ['hello', 7], timestamp: 5 }])
  })

  it('drops console events when no console listener is registered (no work, no throw)', () => {
    // No device.on('console', ...) here. A late listener still sees only events
    // fired after it subscribes — console is never buffered.
    expect(() =>
      fireCdpEvent('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'noisy' }] }),
    ).not.toThrow()

    const seen: ConsoleMessage[] = []
    device.on('console', (m) => seen.push(m))
    fireCdpEvent('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'after' }] })
    expect(seen).toHaveLength(1)
  })

  it('forwards exception events to on("pageerror") listeners', () => {
    const seen: PageError[] = []
    device.on('pageerror', (e) => seen.push(e))

    fireCdpEvent('Runtime.exceptionThrown', {
      exceptionDetails: { exception: { description: 'TypeError: boom' } },
    })

    expect(seen).toHaveLength(1)
    expect(seen[0]?.message).toBe('TypeError: boom')
  })

  it('off() and the returned unsubscribe both stop delivery', () => {
    const a = vi.fn()
    const b = vi.fn()
    const unsub = device.on('console', a)
    device.on('console', b)

    unsub()
    device.off('console', b)
    fireCdpEvent('Runtime.consoleAPICalled', { type: 'log', args: [] })

    expect(a).not.toHaveBeenCalled()
    expect(b).not.toHaveBeenCalled()
  })

  it('does not fail operations on uncaught exceptions by default', async () => {
    fireCdpEvent('Runtime.exceptionThrown', {
      exceptionDetails: { exception: { description: 'Error: ignored' } },
    })

    await expect(device.evaluate('1')).resolves.toBeUndefined()
  })

  it('does not buffer exceptions when failOnUncaughtException is off (no unbounded growth)', () => {
    const seen: PageError[] = []
    device.on('pageerror', (e) => seen.push(e))

    for (let i = 0; i < 50; i++) {
      fireCdpEvent('Runtime.exceptionThrown', {
        exceptionDetails: { exception: { description: `Error: ${i}` } },
      })
    }

    // Listeners still receive every exception...
    expect(seen).toHaveLength(50)
    // ...but nothing accumulates in the fail-fast buffer. With the option off it is
    // never drained, so buffering would grow without bound for the connection.
    const buffer = (device as unknown as { _uncaughtExceptions: PageError[] })._uncaughtExceptions
    expect(buffer).toHaveLength(0)
  })
})

describe('RNDevice failOnUncaughtException', () => {
  it('rejects the next operation with the captured exception, once', async () => {
    vi.clearAllMocks()
    mockSelectedTarget = defaultTarget()
    const device = new RNDevice({ timeout: 1000, failOnUncaughtException: true })
    mockEvaluateFn.mockImplementation((expr: string) => {
      if (isPlatformProbe(expr)) {
        return Promise.resolve('ios')
      }
      return Promise.resolve('ok')
    })
    await device.connect()

    fireCdpEvent('Runtime.exceptionThrown', {
      exceptionDetails: { exception: { description: 'TypeError: kaboom' } },
    })

    await expect(device.evaluate('1')).rejects.toBeInstanceOf(UncaughtExceptionError)
    // Buffer drained — the next operation proceeds normally.
    await expect(device.evaluate('2')).resolves.toBe('ok')
  })

  it('clears buffered exceptions on disconnect so a reconnect is not poisoned', async () => {
    vi.clearAllMocks()
    mockSelectedTarget = defaultTarget()
    const device = new RNDevice({ timeout: 1000, failOnUncaughtException: true })
    mockEvaluateFn.mockImplementation((expr: string) => {
      if (isPlatformProbe(expr)) {
        return Promise.resolve('ios')
      }
      return Promise.resolve('ok')
    })
    await device.connect()

    fireCdpEvent('Runtime.exceptionThrown', {
      exceptionDetails: { exception: { description: 'Error: stale from previous session' } },
    })

    // Disconnect before the exception is ever surfaced, then reconnect the SAME
    // instance. The stale exception must not throw on the new session.
    await device.disconnect()
    await device.connect()

    await expect(device.evaluate('1')).resolves.toBe('ok')
  })

  it('device.files captured before disconnect() fails closed afterwards (lifecycle boundary)', async () => {
    vi.clearAllMocks()
    mockSelectedTarget = defaultTarget()
    const device = new RNDevice({
      timeout: 1000,
      target: { udid: 'UDID-1', bundleId: 'com.acme.app' },
    })
    mockEvaluateFn.mockImplementation((expr: string) =>
      Promise.resolve(isPlatformProbe(expr) ? 'ios' : 'ok'),
    )
    await device.connect()

    // Capture the host-side file I/O object BEFORE disconnect, then drop the
    // connection. Host transports don't need the CDP socket, so without the
    // lifecycle token this reference would keep working past the boundary.
    const files = device.files
    await device.disconnect()

    await expect(files.pull('obs.csv')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      message: expect.stringContaining('disconnected'),
    })
  })

  it('invalidates a device.files captured before a reconnect (no orphaned live token)', async () => {
    vi.clearAllMocks()
    mockSelectedTarget = defaultTarget()
    const device = new RNDevice({
      timeout: 1000,
      target: { udid: 'UDID-1', bundleId: 'com.acme.app' },
    })
    mockEvaluateFn.mockImplementation((expr: string) =>
      Promise.resolve(isPlatformProbe(expr) ? 'ios' : 'ok'),
    )
    await device.connect()
    const stale = device.files // captured against the FIRST connection's token
    const firstTouch = await vi.mocked(createTouchBackend).mock.results[0]?.value

    // Reconnect WITHOUT an intervening disconnect(). The new connection mints a
    // fresh token; the old one must be invalidated now, not left live to survive
    // the next disconnect (which only flips the newest token). The old touch backend
    // must be disposed too, not orphaned (a companion process/port would leak).
    await device.connect()

    await expect(stale.pull('obs.csv')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      message: expect.stringContaining('disconnected'),
    })
    // The current reference from the new connection still works.
    expect(device.files).not.toBe(stale)
    // The prior touch backend was disposed by the reconnect, not leaked.
    expect(firstTouch.backend.dispose).toHaveBeenCalledTimes(1)
  })

  it('caps the exception buffer under a storm (no unbounded growth when enabled)', async () => {
    vi.clearAllMocks()
    mockSelectedTarget = defaultTarget()
    const device = new RNDevice({ timeout: 1000, failOnUncaughtException: true })
    mockEvaluateFn.mockImplementation((expr: string) => {
      if (isPlatformProbe(expr)) {
        return Promise.resolve('ios')
      }
      return Promise.resolve('ok')
    })
    await device.connect()

    // Drain happens one-per-operation; without a cap, a storm between operations
    // grows the buffer without bound. Fire far more than the cap.
    for (let i = 0; i < 500; i++) {
      fireCdpEvent('Runtime.exceptionThrown', {
        exceptionDetails: { exception: { description: `Error: storm ${i}` } },
      })
    }

    const buffer = (device as unknown as { _uncaughtExceptions: PageError[] })._uncaughtExceptions
    expect(buffer.length).toBeLessThanOrEqual(64)
    // The OLDEST is retained (first failure is the most diagnostic).
    expect(buffer[0]?.message).toBe('Error: storm 0')
  })
})
