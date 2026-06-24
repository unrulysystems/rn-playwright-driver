/**
 * E2E tests for device.capabilities() API.
 *
 * Tests the capabilities detection functionality that reports
 * available native modules and harness features.
 */

import { expect, test } from '@unrulysystems/rn-playwright-driver/test'

test.describe('Device Capabilities', () => {
  test('capabilities() returns capability object', async ({ device }) => {
    const caps = await device.capabilities()

    // Should have all expected capability fields
    expect(caps).toHaveProperty('viewTree')
    expect(caps).toHaveProperty('screenshot')
    expect(caps).toHaveProperty('lifecycle')
    expect(caps).toHaveProperty('touchNative')
  })

  test('capabilities() returns boolean values', async ({ device }) => {
    const caps = await device.capabilities()

    expect(typeof caps.viewTree).toBe('boolean')
    expect(typeof caps.screenshot).toBe('boolean')
    expect(typeof caps.lifecycle).toBe('boolean')
    expect(typeof caps.touchNative).toBe('boolean')
  })

  test('capabilities match harness-reported capabilities', async ({ device }) => {
    const deviceCaps = await device.capabilities()

    // Compare with direct harness query
    const harnessCaps = await device.evaluate<{
      viewTree: boolean
      screenshot: boolean
      lifecycle: boolean
      touchNative: boolean
    }>('globalThis.__RN_DRIVER__.capabilities')

    expect(deviceCaps.viewTree).toBe(harnessCaps.viewTree)
    expect(deviceCaps.screenshot).toBe(harnessCaps.screenshot)
    expect(deviceCaps.lifecycle).toBe(harnessCaps.lifecycle)
    expect(deviceCaps.touchNative).toBe(harnessCaps.touchNative)
  })
})
