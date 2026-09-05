/**
 * Tests for core primitives in the harness.
 * These tests verify the harness functionality in a Node.js environment
 * by mocking the React Native runtime.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock __DEV__ and requestAnimationFrame before importing harness
declare global {
  var __DEV__: boolean | undefined
  var requestAnimationFrame: (callback: (timestamp: number) => void) => number
}

// Setup mocks before importing harness
let rafCallbacks: Array<(timestamp: number) => void> = []
let rafId = 0

globalThis.__DEV__ = false
globalThis.requestAnimationFrame = (callback: (timestamp: number) => void): number => {
  rafCallbacks.push(callback)
  return ++rafId
}

// Mock console to prevent noise during tests
const originalConsole = { ...console }

describe('Harness Core Primitives', () => {
  beforeEach(() => {
    // Reset module cache so harness reinstalls fresh
    vi.resetModules()
    // Reset RAF state
    rafCallbacks = []
    rafId = 0
    // Reset __RN_DRIVER__ for fresh install
    globalThis.__RN_DRIVER__ = undefined
    // Restore console
    Object.assign(console, originalConsole)
  })

  describe('RAF Frame Counter', () => {
    it('schedules no frame work on install (REQ-SEAM-006)', async () => {
      await import('../harness/index')

      expect(globalThis.__RN_DRIVER__).toBeDefined()
      expect(rafCallbacks).toHaveLength(0)
    })

    it('starts counting on the first getFrameCount call and advances once per frame', async () => {
      await import('../harness/index')
      const harness = globalThis.__RN_DRIVER__
      expect(harness).toBeDefined()

      const initialCount = harness!.getFrameCount()
      expect(rafCallbacks).toHaveLength(1)

      for (let i = 0; i < 3; i++) {
        const callbacks = [...rafCallbacks]
        rafCallbacks = []
        for (const cb of callbacks) {
          cb(Date.now())
        }
      }

      expect(harness!.getFrameCount()).toBe(initialCount + 3)
      // A second read reuses the running loop rather than scheduling another.
      expect(rafCallbacks).toHaveLength(1)
    })
  })

  describe('Tracing', () => {
    it('should not record events when tracing is inactive', async () => {
      await import('../harness/index')
      const harness = globalThis.__RN_DRIVER__
      expect(harness).toBeDefined()

      // Tracing should be inactive by default
      expect(harness!.isTracing()).toBe(false)

      // Events should not be recorded
      harness!.traceEvent('pointer:tap', { x: 100, y: 200 })

      const result = harness!.stopTracing()
      expect(result.events).toHaveLength(0)
    })

    it('should record events when tracing is active', async () => {
      await import('../harness/index')
      const harness = globalThis.__RN_DRIVER__
      expect(harness).toBeDefined()

      harness!.startTracing()
      expect(harness!.isTracing()).toBe(true)

      // Record some events
      harness!.traceEvent('pointer:tap', { x: 100, y: 200 })
      harness!.traceEvent('evaluate', { expression: '1+1' })

      const result = harness!.stopTracing()
      expect(result.events.length).toBeGreaterThanOrEqual(2)

      // Verify event structure
      const tapEvent = result.events.find((e) => e.type === 'pointer:tap')
      expect(tapEvent).toBeDefined()
      expect(tapEvent!.data).toEqual({ x: 100, y: 200 })
      expect(typeof tapEvent!.timestamp).toBe('number')

      const evalEvent = result.events.find((e) => e.type === 'evaluate')
      expect(evalEvent).toBeDefined()
      expect(evalEvent!.data).toEqual({ expression: '1+1' })
    })

    it('should clear events after stopTracing', async () => {
      await import('../harness/index')
      const harness = globalThis.__RN_DRIVER__
      expect(harness).toBeDefined()

      harness!.startTracing()
      harness!.traceEvent('pointer:tap', { x: 0, y: 0 })
      harness!.stopTracing()

      // Start new tracing session
      harness!.startTracing()
      const result = harness!.stopTracing()
      expect(result.events).toHaveLength(0)
    })

    it('should respect ring buffer limit', async () => {
      await import('../harness/index')
      const harness = globalThis.__RN_DRIVER__
      expect(harness).toBeDefined()

      harness!.startTracing()

      // Add more events than the buffer limit (1000)
      for (let i = 0; i < 1100; i++) {
        harness!.traceEvent('pointer:move', { x: i, y: i })
      }

      const result = harness!.stopTracing()
      expect(result.events.length).toBeLessThanOrEqual(1000)
    })

    it('should record error events', async () => {
      await import('../harness/index')
      const harness = globalThis.__RN_DRIVER__
      expect(harness).toBeDefined()

      harness!.startTracing()
      harness!.traceEvent('error', { source: 'test', message: 'test error' })

      const result = harness!.stopTracing()
      const errorEvent = result.events.find((e) => e.type === 'error')
      expect(errorEvent).toBeDefined()
      expect(errorEvent!.data).toEqual({ source: 'test', message: 'test error' })
    })
  })

  describe('Window Metrics', () => {
    it('should return fallback metrics in non-RN environment', async () => {
      await import('../harness/index')
      const harness = globalThis.__RN_DRIVER__
      expect(harness).toBeDefined()

      const metrics = harness!.getWindowMetrics()
      expect(metrics).toEqual({
        width: 0,
        height: 0,
        pixelRatio: 1,
        scale: 1,
        fontScale: 1,
        orientation: 'portrait',
      })
    })
  })
})
