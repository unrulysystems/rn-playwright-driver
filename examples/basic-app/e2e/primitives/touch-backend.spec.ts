/**
 * E2E tests for device.getTouchBackendInfo() API.
 *
 * Tests touch backend detection and selection reporting.
 */

import { expect, test } from '@unrulysystems/rn-playwright-driver/test'

const validBackends = ['xctest', 'instrumentation', 'native-module', 'cli', 'harness']

test.describe('Touch Backend Info', () => {
  test('getTouchBackendInfo() returns backend info object', async ({ device }) => {
    const info = await device.getTouchBackendInfo()

    expect(info).toHaveProperty('selected')
    expect(info).toHaveProperty('available')
  })

  test('selected backend is a valid backend type', async ({ device }) => {
    const info = await device.getTouchBackendInfo()

    expect(validBackends).toContain(info.selected)
  })

  test('available backends is an array', async ({ device }) => {
    const info = await device.getTouchBackendInfo()

    expect(Array.isArray(info.available)).toBe(true)
    expect(info.available.length).toBeGreaterThan(0)
  })

  test('selected backend is in available list', async ({ device }) => {
    const info = await device.getTouchBackendInfo()

    expect(info.available).toContain(info.selected)
  })

  test('reason field is present if provided', async ({ device }) => {
    const info = await device.getTouchBackendInfo()

    // Reason is optional but should be a string if present
    if (info.reason !== undefined) {
      expect(typeof info.reason).toBe('string')
    }
  })

  test('backend info is consistent across multiple calls', async ({ device }) => {
    const info1 = await device.getTouchBackendInfo()
    const info2 = await device.getTouchBackendInfo()

    expect(info1.selected).toBe(info2.selected)
    expect(info1.available).toEqual(info2.available)
  })

  test('all available backends are valid types', async ({ device }) => {
    const info = await device.getTouchBackendInfo()

    for (const backend of info.available) {
      expect(validBackends).toContain(backend)
    }
  })

  test('backend selection follows platform defaults or forced env override', async ({ device }) => {
    const caps = await device.capabilities()
    const info = await device.getTouchBackendInfo()
    const forcedBackend = process.env.RN_TOUCH_BACKEND

    if (forcedBackend) {
      expect(info.selected).toBe(forcedBackend)
      return
    }

    if (device.platform === 'ios' && caps.touchNative) {
      expect(info.selected).toBe('native-module')
      return
    }

    expect(validBackends).toContain(info.selected)
    expect(info.available).toContain(info.selected)
  })
})
