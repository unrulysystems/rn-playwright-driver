/**
 * E2E tests for frame timing APIs.
 *
 * Tests getFrameCount(), waitForRaf(), and waitForFrameCount() primitives
 * for animation synchronization.
 */

import { expect, test } from '@0xbigboss/rn-playwright-driver/test'

test.describe('Frame Timing', () => {
  test('getFrameCount() returns a number', async ({ device }) => {
    const frameCount = await device.getFrameCount()

    expect(typeof frameCount).toBe('number')
    expect(Number.isInteger(frameCount)).toBe(true)
    expect(frameCount).toBeGreaterThanOrEqual(0)
  })

  test('getFrameCount() is monotonically increasing', async ({ device }) => {
    const count1 = await device.getFrameCount()

    // Wait a bit for frames to advance
    await device.waitForTimeout(50)

    const count2 = await device.getFrameCount()

    expect(count2).toBeGreaterThanOrEqual(count1)
  })

  test('waitForRaf() waits for one animation frame by default', async ({ device }) => {
    const beforeCount = await device.getFrameCount()

    await device.waitForRaf()

    const afterCount = await device.getFrameCount()

    // Should have advanced at least one frame
    expect(afterCount).toBeGreaterThan(beforeCount)
  })

  test('waitForRaf(n) waits for n animation frames', async ({ device }) => {
    const beforeCount = await device.getFrameCount()
    const framesToWait = 3

    await device.waitForRaf(framesToWait)

    const afterCount = await device.getFrameCount()

    // Should have advanced at least n frames
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount + framesToWait)
  })

  test('waitForRaf(0) returns immediately', async ({ device }) => {
    const beforeCount = await device.getFrameCount()

    await device.waitForRaf(0)

    const afterCount = await device.getFrameCount()

    // Should not necessarily wait for any frames
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount)
  })

  test('waitForFrameCount() waits until frame count reaches target', async ({ device }) => {
    const currentCount = await device.getFrameCount()
    const targetCount = currentCount + 2

    await device.waitForFrameCount(targetCount)

    const afterCount = await device.getFrameCount()

    expect(afterCount).toBeGreaterThanOrEqual(targetCount)
  })

  test('waitForFrameCount() returns immediately if already at target', async ({ device }) => {
    const currentCount = await device.getFrameCount()

    // Target a frame count we've already passed
    await device.waitForFrameCount(0)

    const afterCount = await device.getFrameCount()

    // Should return quickly without blocking
    expect(afterCount).toBeGreaterThanOrEqual(currentCount)
  })

  test('waitForFrameCount() returns immediately if past target', async ({ device }) => {
    const currentCount = await device.getFrameCount()

    // Wait for the current count (already reached)
    await device.waitForFrameCount(currentCount)

    const afterCount = await device.getFrameCount()

    expect(afterCount).toBeGreaterThanOrEqual(currentCount)
  })

  test('frame count advances during waitForTimeout', async ({ device }) => {
    const beforeCount = await device.getFrameCount()

    // Wait 100ms - at 60fps this should be ~6 frames
    await device.waitForTimeout(100)

    const afterCount = await device.getFrameCount()

    // Should have advanced some frames
    expect(afterCount).toBeGreaterThan(beforeCount)
  })

  test('multiple waitForRaf calls work in sequence', async ({ device }) => {
    const counts: number[] = []

    counts.push(await device.getFrameCount())
    for (let i = 0; i < 3; i++) {
      await device.waitForRaf()
      counts.push(await device.getFrameCount())
    }

    // Each count should be >= the previous
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1])
    }
  })
})
