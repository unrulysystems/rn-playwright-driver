/**
 * Tests for RNDevice core primitives.
 * These tests verify the device-level API behavior by mocking the CDP layer.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RNDevice, TimeoutError, UncaughtExceptionError } from './device'
import type { ConsoleMessage, PageError } from './types'

// Store mock evaluate + onEvent for tests to access
let mockEvaluateFn: ReturnType<typeof vi.fn>
let mockOnEventFn: ReturnType<typeof vi.fn>

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

// Mock CDP discovery
vi.mock('./cdp/discovery', () => ({
  discoverTargets: vi.fn().mockResolvedValue([
    {
      id: 'test-target',
      title: 'Test App',
      webSocketDebuggerUrl: 'ws://localhost:8081/debugger',
    },
  ]),
  selectTarget: vi.fn().mockReturnValue({
    id: 'test-target',
    title: 'Test App',
    webSocketDebuggerUrl: 'ws://localhost:8081/debugger',
  }),
}))

// Mock touch backend
vi.mock('./touch', () => ({
  createTouchBackend: vi.fn().mockResolvedValue({
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

    device = new RNDevice({ timeout: 1000 })

    // Default mock for platform detection
    mockEvaluateFn.mockImplementation((expr: string) => {
      if (expr.includes('Platform.OS')) {
        return Promise.resolve('ios')
      }
      return Promise.resolve(undefined)
    })

    await device.connect()
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
    device = new RNDevice({ timeout: 1000 })
    mockEvaluateFn.mockResolvedValue(undefined)
    await device.connect()
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
    const device = new RNDevice({ timeout: 1000, failOnUncaughtException: true })
    mockEvaluateFn.mockResolvedValue('ok')
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
    const device = new RNDevice({ timeout: 1000, failOnUncaughtException: true })
    mockEvaluateFn.mockResolvedValue('ok')
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
})
