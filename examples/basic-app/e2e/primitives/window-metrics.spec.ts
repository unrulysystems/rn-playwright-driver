/**
 * E2E tests for device.getWindowMetrics() API.
 *
 * Tests window metrics retrieval including dimensions, pixel ratio,
 * font scale, and orientation.
 */

import { expect, test } from '@unrulysystems/rn-playwright-driver/test'

test.describe('Window Metrics', () => {
  test('getWindowMetrics() returns complete metrics object', async ({ device }) => {
    const metrics = await device.getWindowMetrics()

    // Should have all expected fields
    expect(metrics).toHaveProperty('width')
    expect(metrics).toHaveProperty('height')
    expect(metrics).toHaveProperty('pixelRatio')
    expect(metrics).toHaveProperty('scale')
    expect(metrics).toHaveProperty('fontScale')
    expect(metrics).toHaveProperty('orientation')
  })

  test('window dimensions are positive numbers', async ({ device }) => {
    const metrics = await device.getWindowMetrics()

    expect(typeof metrics.width).toBe('number')
    expect(typeof metrics.height).toBe('number')
    expect(metrics.width).toBeGreaterThan(0)
    expect(metrics.height).toBeGreaterThan(0)
  })

  test('pixel ratio is a positive number', async ({ device }) => {
    const metrics = await device.getWindowMetrics()

    expect(typeof metrics.pixelRatio).toBe('number')
    expect(metrics.pixelRatio).toBeGreaterThan(0)
    // Common pixel ratios: 1, 2, 3 (retina), 3.5 (some Android devices)
    expect(metrics.pixelRatio).toBeLessThanOrEqual(5)
  })

  test('scale equals pixelRatio', async ({ device }) => {
    const metrics = await device.getWindowMetrics()

    // scale is an alias for pixelRatio (matches RN PixelRatio.get())
    expect(metrics.scale).toBe(metrics.pixelRatio)
  })

  test('fontScale is a positive number', async ({ device }) => {
    const metrics = await device.getWindowMetrics()

    expect(typeof metrics.fontScale).toBe('number')
    expect(metrics.fontScale).toBeGreaterThan(0)
    // Font scale is typically 1.0 by default, but can vary with accessibility settings
    expect(metrics.fontScale).toBeLessThanOrEqual(3)
  })

  test('orientation is portrait or landscape', async ({ device }) => {
    const metrics = await device.getWindowMetrics()

    expect(['portrait', 'landscape']).toContain(metrics.orientation)
  })

  test('orientation matches dimension ratio', async ({ device }) => {
    const metrics = await device.getWindowMetrics()

    if (metrics.height >= metrics.width) {
      expect(metrics.orientation).toBe('portrait')
    } else {
      expect(metrics.orientation).toBe('landscape')
    }
  })

  test('safeAreaInsets are present if available', async ({ device }) => {
    const metrics = await device.getWindowMetrics()

    // Safe area insets are optional (require react-native-safe-area-context)
    if (metrics.safeAreaInsets) {
      expect(typeof metrics.safeAreaInsets.top).toBe('number')
      expect(typeof metrics.safeAreaInsets.right).toBe('number')
      expect(typeof metrics.safeAreaInsets.bottom).toBe('number')
      expect(typeof metrics.safeAreaInsets.left).toBe('number')

      // Insets should be non-negative
      expect(metrics.safeAreaInsets.top).toBeGreaterThanOrEqual(0)
      expect(metrics.safeAreaInsets.right).toBeGreaterThanOrEqual(0)
      expect(metrics.safeAreaInsets.bottom).toBeGreaterThanOrEqual(0)
      expect(metrics.safeAreaInsets.left).toBeGreaterThanOrEqual(0)
    }
  })

  test('metrics are consistent across multiple calls', async ({ device }) => {
    const metrics1 = await device.getWindowMetrics()
    const metrics2 = await device.getWindowMetrics()

    // Metrics should be stable between calls (unless orientation changes)
    expect(metrics1.width).toBe(metrics2.width)
    expect(metrics1.height).toBe(metrics2.height)
    expect(metrics1.pixelRatio).toBe(metrics2.pixelRatio)
    expect(metrics1.orientation).toBe(metrics2.orientation)
  })
})
