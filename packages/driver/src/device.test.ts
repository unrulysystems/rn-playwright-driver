/**
 * Tests for RNDevice core primitives.
 * These tests verify the device-level API behavior by mocking the CDP layer.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RNDevice, TimeoutError } from './device'

// Store mock evaluate for tests to access
let mockEvaluateFn: ReturnType<typeof vi.fn>

// Mock the CDP client with a class
vi.mock('./cdp/client', () => {
  return {
    CDPClient: class MockCDPClient {
      evaluate = vi.fn()
      connect = vi.fn()
      disconnect = vi.fn()
      ping = vi.fn().mockResolvedValue(true)

      constructor() {
        mockEvaluateFn = this.evaluate
      }
    },
  }
})

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
