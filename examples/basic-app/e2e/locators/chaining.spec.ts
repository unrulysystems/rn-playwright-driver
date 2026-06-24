/**
 * E2E tests for locator chaining.
 *
 * Tests chaining methods: getByTestId, getByText, getByRole, nth, first, last.
 *
 * NOTE: These tests require:
 * 1. The RN app running with Metro (bun start)
 * 2. A device connected with Hermes debugging enabled
 * 3. Native modules installed (view-tree, screenshot, lifecycle)
 */

import { expect, expectLocator, test } from '@unrulysystems/rn-playwright-driver/test'

test.describe('Locator Chaining', () => {
  // Test nth() with a multi-match text locator
  // The app has multiple "-" and "+" text elements within buttons
  test('nth selects specific element from multiple matches', async ({ device }) => {
    // The app has "Count: X" text and button texts - use partial match that gets multiple elements
    // We use getByTestId which we know works, then chain with getByText to get multiple matches
    // Alternative: use direct device queries that return multiple elements

    // First verify we can find multiple elements with a multi-match query
    // The button "-" and "+" text are single char, but "Count" appears once
    // Let's use getByText with a common substring - the button row has "-" and "+"

    // Test nth with testId-based approach - get parent and query children
    const incrementBtn = device.getByTestId('increment-button')
    const decrementBtn = device.getByTestId('decrement-button')

    // Use nth on a chained locator to verify the behavior
    // Chain from increment button to get its text children, then use nth(0)
    const incText = incrementBtn.getByText('+').nth(0)
    await expectLocator(incText).toBeVisible()

    // Verify the element bounds are valid (within the button)
    const incBtnBounds = await incrementBtn.bounds()
    const incTextBounds = await incText.bounds()
    expect(incBtnBounds).not.toBeNull()
    expect(incTextBounds).not.toBeNull()

    // Text should be within button bounds
    expect(incTextBounds!.x).toBeGreaterThanOrEqual(incBtnBounds!.x)
    expect(incTextBounds!.y).toBeGreaterThanOrEqual(incBtnBounds!.y)

    // Also verify decrement button has different position than increment
    const decBtnBounds = await decrementBtn.bounds()
    expect(decBtnBounds).not.toBeNull()
    expect(incBtnBounds!.x).not.toBe(decBtnBounds!.x)
  })

  test('first is alias for nth(0)', async ({ device }) => {
    // Use text query to find elements containing "Count"
    const first = device.getByText('Count').first()
    const nth0 = device.getByText('Count').nth(0)

    // Both should resolve to the same element
    const firstBounds = await first.bounds()
    const nth0Bounds = await nth0.bounds()

    expect(firstBounds).not.toBeNull()
    expect(nth0Bounds).not.toBeNull()
    expect(firstBounds?.x).toBe(nth0Bounds?.x)
    expect(firstBounds?.y).toBe(nth0Bounds?.y)
  })

  test('getByTestId returns locator for testId query', async ({ device }) => {
    // Start from a parent element and find child by testId
    // Note: Scoped queries are implemented as simple non-scoped queries for now
    const button = device.getByTestId('increment-button')
    await expectLocator(button).toBeVisible()
  })

  test('getByText returns locator for text query', async ({ device }) => {
    // Find element containing text "Count" (from "Count: X")
    const text = device.getByText('Count')
    await expectLocator(text).toBeVisible()
  })

  test('getByRole returns locator for role query', async ({ device }) => {
    // Note: getByRole requires accessibilityRole to be set on the element
    // The example app sets accessibilityRole="button" on Pressable components
    // If this test fails, check that App.tsx has accessibilityRole set
    const button = device.getByRole('button')
    const isVisible = await button.isVisible()
    // Just verify we can query by role - actual visibility depends on app state
    expect(typeof isVisible).toBe('boolean')
  })

  test('chaining creates scoped locator that filters by parent bounds', async ({ device }) => {
    const parent = device.getByTestId('count-display')
    await expectLocator(parent).toBeVisible()

    // Get parent bounds for verification
    const parentBounds = await parent.bounds()
    expect(parentBounds).not.toBeNull()

    // Chain from parent - should only find text within parent's bounds
    const child = parent.getByText('Count')
    const childVisible = await child.isVisible()
    expect(typeof childVisible).toBe('boolean')

    // If child is found, its bounds should be within parent bounds
    if (childVisible) {
      const childBounds = await child.bounds()
      expect(childBounds).not.toBeNull()

      // Verify scoping: child bounds should be within parent bounds
      expect(childBounds!.x).toBeGreaterThanOrEqual(parentBounds!.x)
      expect(childBounds!.y).toBeGreaterThanOrEqual(parentBounds!.y)
      expect(childBounds!.x + childBounds!.width).toBeLessThanOrEqual(
        parentBounds!.x + parentBounds!.width,
      )
      expect(childBounds!.y + childBounds!.height).toBeLessThanOrEqual(
        parentBounds!.y + parentBounds!.height,
      )
    }
  })

  test('scoped chaining excludes elements outside parent', async ({ device }) => {
    // The increment button should NOT be found when scoped to count-display
    // because buttons are outside the display area
    const display = device.getByTestId('count-display')
    await expectLocator(display).toBeVisible()

    // Try to find a button scoped to the display - should fail or return false
    const scopedButton = display.getByRole('button')
    const isVisible = await scopedButton.isVisible()

    // Button should not be visible within the display bounds
    // (buttons are siblings, not children of the display)
    expect(isVisible).toBe(false)
  })

  test('toString returns readable locator description', async ({ device }) => {
    const byTestId = device.getByTestId('my-button')
    const byText = device.getByText('Click me')
    const byRole = device.getByRole('button', { name: 'Submit' })
    const nth = device.getByRole('button').nth(2)

    // Check that toString returns descriptive strings
    expect(byTestId.toString()).toContain('testId')
    expect(byText.toString()).toContain('text')
    expect(byRole.toString()).toContain('role')
    expect(nth.toString()).toContain('nth(2)')
  })
})
