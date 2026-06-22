import { beforeEach, describe, expect, it } from 'vitest'
import type { Pointer } from './pointer'
import {
  createPointerHarness,
  FRAME_MS,
  type MockTouchBackend,
  type TimeoutProvider,
} from './test-utils'

describe('Gesture Builder', () => {
  let pointer: Pointer
  let mockBackend: MockTouchBackend
  let mockTimeoutProvider: TimeoutProvider

  beforeEach(() => {
    ;({ pointer, mockBackend, mockTimeoutProvider } = createPointerHarness())
  })

  it('should execute planned events in order', async () => {
    const gesture = pointer
      .gesture()
      .down(0, 0)
      .wait(10)
      .moveTo(10, 0, { steps: 2 })
      .waitFrames(1)
      .up()

    await gesture.execute()

    expect(mockBackend.down).toHaveBeenCalledWith(0, 0)
    expect(mockBackend.move).toHaveBeenCalledTimes(2)
    expect(mockBackend.move).toHaveBeenNthCalledWith(1, 5, 0)
    expect(mockBackend.move).toHaveBeenNthCalledWith(2, 10, 0)
    expect(mockBackend.up).toHaveBeenCalledTimes(1)
    expect(mockTimeoutProvider.waitForTimeout).toHaveBeenCalledTimes(2)
    expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(1, 10)
    expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(2, FRAME_MS)
  })

  it('should expose planned events via toEvents()', () => {
    const events = pointer.gesture().down(1, 2).wait(5).moveTo(3, 4).up().toEvents()

    expect(events).toEqual([
      { type: 'down', x: 1, y: 2, pointerId: undefined, pressure: undefined },
      { type: 'wait', ms: 5 },
      { type: 'move', x: 3, y: 4, pointerId: undefined },
      { type: 'up', pointerId: undefined, pressure: undefined },
    ])
  })
})

describe('MultiGesture Builder', () => {
  let pointer: Pointer
  let mockBackend: MockTouchBackend
  let mockTimeoutProvider: TimeoutProvider

  beforeEach(() => {
    ;({ pointer, mockBackend, mockTimeoutProvider } = createPointerHarness())
  })

  it('should execute pointer sequences in timestamp order', async () => {
    const multi = pointer.multiGesture()
    multi.pointer(0).down(0, 0).wait(20).up()
    multi.pointer(1).down(10, 0).wait(10).up()

    await multi.execute()

    expect(mockBackend.down).toHaveBeenCalledTimes(2)
    expect(mockBackend.down).toHaveBeenNthCalledWith(1, 0, 0, { pointerId: 0 })
    expect(mockBackend.down).toHaveBeenNthCalledWith(2, 10, 0, { pointerId: 1 })

    expect(mockBackend.up).toHaveBeenCalledTimes(2)
    expect(mockBackend.up).toHaveBeenNthCalledWith(1, { pointerId: 1 })
    expect(mockBackend.up).toHaveBeenNthCalledWith(2, { pointerId: 0 })

    expect(mockTimeoutProvider.waitForTimeout).toHaveBeenCalledTimes(2)
    expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(1, 10)
    expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(2, 10)
  })
})
