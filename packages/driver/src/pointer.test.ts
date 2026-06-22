/**
 * Tests for Pointer class timing and path methods.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pointer } from './pointer'
import {
  createPointerHarness,
  FRAME_MS,
  type MockTouchBackend,
  type TimeoutProvider,
} from './test-utils'

describe('Pointer Path Methods', () => {
  let pointer: Pointer
  let mockBackend: MockTouchBackend
  let mockTimeoutProvider: TimeoutProvider

  beforeEach(() => {
    ;({ pointer, mockBackend, mockTimeoutProvider } = createPointerHarness())
  })

  describe('move', () => {
    it('should interpolate moves when steps > 1', async () => {
      await pointer.down(0, 0)
      await pointer.move(10, 0, { steps: 2 })

      expect(mockBackend.move).toHaveBeenCalledTimes(2)
      expect(mockBackend.move).toHaveBeenNthCalledWith(1, 5, 0)
      expect(mockBackend.move).toHaveBeenNthCalledWith(2, 10, 0)
    })
  })

  describe('drag', () => {
    it('should apply default holdStart/holdEnd delays', async () => {
      await pointer.drag({ x: 0, y: 0 }, { x: 10, y: 10 })

      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenCalledTimes(2)
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(1, FRAME_MS)
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(2, FRAME_MS)
    })

    it('should apply custom holdStart/holdEnd delays', async () => {
      await pointer.drag({ x: 0, y: 0 }, { x: 10, y: 10 }, { holdStart: 50, holdEnd: 25, steps: 1 })

      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenCalledTimes(2)
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(1, 50)
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(2, 25)
    })

    it('should skip hold delays when set to 0', async () => {
      await pointer.drag({ x: 0, y: 0 }, { x: 10, y: 10 }, { holdStart: 0, holdEnd: 0, steps: 1 })

      expect(mockTimeoutProvider.waitForTimeout).not.toHaveBeenCalled()
    })

    it('should wait between moves when duration is set', async () => {
      await pointer.drag(
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { duration: 32, holdStart: 0, holdEnd: 0 },
      )

      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenCalledTimes(2)
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(1, 16)
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(2, 16)
    })

    it('should apply easing when provided', async () => {
      await pointer.drag(
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { steps: 2, holdStart: 0, holdEnd: 0, easing: 'ease-in' },
      )

      const calls = mockBackend.move.mock.calls
      expect(calls).toHaveLength(2)
      expect(calls[0]?.[0]).toBeCloseTo(2.5, 5)
      expect(calls[1]?.[0]).toBeCloseTo(10, 5)
    })
  })

  describe('tap', () => {
    it('should support multi-tap with custom delays', async () => {
      await pointer.tap(5, 5, { count: 2, holdStart: 10, tapDelay: 20 })

      expect(mockBackend.down).toHaveBeenCalledTimes(2)
      expect(mockBackend.up).toHaveBeenCalledTimes(2)
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenCalledTimes(3)
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(1, 10)
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(2, 20)
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(3, 10)
    })
  })

  describe('dragPath', () => {
    it('should do nothing for empty path', async () => {
      await pointer.dragPath([])

      expect(mockBackend.down).not.toHaveBeenCalled()
      expect(mockBackend.move).not.toHaveBeenCalled()
      expect(mockBackend.up).not.toHaveBeenCalled()
    })

    it('should press at first point and release at last', async () => {
      const points = [
        { x: 100, y: 100 },
        { x: 150, y: 150 },
        { x: 200, y: 200 },
      ]

      await pointer.dragPath(points)

      expect(mockBackend.down).toHaveBeenCalledTimes(1)
      expect(mockBackend.down).toHaveBeenCalledWith(100, 100)

      expect(mockBackend.move).toHaveBeenCalledTimes(2)
      expect(mockBackend.move).toHaveBeenNthCalledWith(1, 150, 150)
      expect(mockBackend.move).toHaveBeenNthCalledWith(2, 200, 200)

      expect(mockBackend.up).toHaveBeenCalledTimes(1)
    })

    it('should handle single point path', async () => {
      const points = [{ x: 50, y: 75 }]

      await pointer.dragPath(points)

      expect(mockBackend.down).toHaveBeenCalledWith(50, 75)
      expect(mockBackend.move).not.toHaveBeenCalled()
      expect(mockBackend.up).toHaveBeenCalledTimes(1)
    })

    it('should apply delay between points when specified', async () => {
      const points = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ]

      await pointer.dragPath(points, { delay: 50 })

      // Delay should be applied after each move, plus frame delays for down/up.
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenCalledTimes(4)
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(1, FRAME_MS)
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(2, 50)
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(3, 50)
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(4, FRAME_MS)
    })

    it('should not apply delay when delay is 0', async () => {
      const points = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]

      await pointer.dragPath(points, { delay: 0 })

      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenCalledTimes(2)
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(1, FRAME_MS)
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(2, FRAME_MS)
    })

    it('should skip hold delays when set to 0', async () => {
      const points = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]

      await pointer.dragPath(points, { holdStart: 0, holdEnd: 0 })

      expect(mockTimeoutProvider.waitForTimeout).not.toHaveBeenCalled()
    })

    it('should execute in correct order: down, moves, up', async () => {
      const callOrder: string[] = []

      mockBackend.down = vi.fn().mockImplementation(() => {
        callOrder.push('down')
        return Promise.resolve()
      })
      mockBackend.move = vi.fn().mockImplementation(() => {
        callOrder.push('move')
        return Promise.resolve()
      })
      mockBackend.up = vi.fn().mockImplementation(() => {
        callOrder.push('up')
        return Promise.resolve()
      })

      await pointer.dragPath([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ])

      expect(callOrder).toEqual(['down', 'move', 'move', 'up'])
    })
  })

  describe('movePath', () => {
    it('should do nothing for empty path', async () => {
      await pointer.movePath([])

      expect(mockBackend.move).not.toHaveBeenCalled()
    })

    it('should move through all points without down/up', async () => {
      const points = [
        { x: 100, y: 100 },
        { x: 150, y: 150 },
        { x: 200, y: 200 },
      ]

      await pointer.movePath(points)

      expect(mockBackend.down).not.toHaveBeenCalled()
      expect(mockBackend.up).not.toHaveBeenCalled()

      expect(mockBackend.move).toHaveBeenCalledTimes(3)
      expect(mockBackend.move).toHaveBeenNthCalledWith(1, 100, 100)
      expect(mockBackend.move).toHaveBeenNthCalledWith(2, 150, 150)
      expect(mockBackend.move).toHaveBeenNthCalledWith(3, 200, 200)
    })

    it('should handle single point path', async () => {
      const points = [{ x: 50, y: 75 }]

      await pointer.movePath(points)

      expect(mockBackend.move).toHaveBeenCalledTimes(1)
      expect(mockBackend.move).toHaveBeenCalledWith(50, 75)
    })

    it('should apply delay between points but not after last', async () => {
      const points = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ]

      await pointer.movePath(points, { delay: 25 })

      // Delay should be applied between points but not after last
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenCalledTimes(2)
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenCalledWith(25)
    })

    it('should not apply delay for single point', async () => {
      const points = [{ x: 0, y: 0 }]

      await pointer.movePath(points, { delay: 25 })

      expect(mockTimeoutProvider.waitForTimeout).not.toHaveBeenCalled()
    })

    it('should not apply delay when delay is 0', async () => {
      const points = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]

      await pointer.movePath(points, { delay: 0 })

      expect(mockTimeoutProvider.waitForTimeout).not.toHaveBeenCalled()
    })
  })
})
