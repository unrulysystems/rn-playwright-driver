/**
 * E2E tests for locator assertions.
 *
 * Tests the expect() matchers: toBeVisible, toHaveText, toBeEnabled, toBeDisabled, toBeAttached.
 *
 * NOTE: These tests require:
 * 1. The RN app running with Metro (nub start)
 * 2. A device connected with Hermes debugging enabled
 * 3. Native modules installed (view-tree, screenshot, lifecycle)
 */

import { expect, expectLocator, test } from '@unrulysystems/rn-playwright-driver/test'

test.describe('Locator Assertions', () => {
  test('toBeVisible waits for element to appear', async ({ device }) => {
    // The counter display should be visible
    const counter = device.getByTestId('count-display')
    await expectLocator(counter).toBeVisible()
  })

  test('toBeVisible with custom timeout', async ({ device }) => {
    const counter = device.getByTestId('count-display')
    await expectLocator(counter).toBeVisible({ timeout: 10000 })
  })

  test('not.toBeVisible passes for hidden elements', async ({ device }) => {
    // Look for an element that doesn't exist
    const nonExistent = device.getByTestId('does-not-exist-12345')
    await expectLocator(nonExistent).not.toBeVisible({ timeout: 1000 })
  })

  test('toBeAttached checks element exists in tree', async ({ device }) => {
    const counter = device.getByTestId('count-display')
    await expectLocator(counter).toBeAttached()
  })

  test('toBeEnabled passes for interactive elements', async ({ device }) => {
    const incrementButton = device.getByTestId('increment-button')
    await expectLocator(incrementButton).toBeEnabled()
  })

  test('isVisible returns boolean without throwing', async ({ device }) => {
    const counter = device.getByTestId('count-display')
    const isVisible = await counter.isVisible()
    expect(typeof isVisible).toBe('boolean')
    expect(isVisible).toBe(true)
  })

  test('bounds returns element position and size', async ({ device }) => {
    const counter = device.getByTestId('count-display')
    const bounds = await counter.bounds()
    expect(bounds).not.toBeNull()
    expect(bounds?.x).toBeGreaterThanOrEqual(0)
    expect(bounds?.y).toBeGreaterThanOrEqual(0)
    expect(bounds?.width).toBeGreaterThan(0)
    expect(bounds?.height).toBeGreaterThan(0)
  })

  test('type throws NOT_SUPPORTED with helpful message', async ({ device }) => {
    const button = device.getByTestId('increment-button')
    await expectLocator(button).toBeVisible()

    // type() should throw NOT_SUPPORTED with workaround message
    await expect(button.type('test')).rejects.toThrow(/NOT_SUPPORTED|not yet implemented/i)
  })

  test('scrollIntoView throws NOT_SUPPORTED with helpful message', async ({ device }) => {
    const button = device.getByTestId('increment-button')
    await expectLocator(button).toBeVisible()

    // scrollIntoView() should throw NOT_SUPPORTED with workaround message
    await expect(button.scrollIntoView()).rejects.toThrow(/NOT_SUPPORTED|not yet implemented/i)
  })
})
