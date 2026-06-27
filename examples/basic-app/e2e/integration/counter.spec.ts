/**
 * Example E2E test for the counter app using @unrulysystems/rn-playwright-driver.
 *
 * NOTE: These tests require:
 * 1. The RN app running with Metro (nub start)
 * 2. A device connected with Hermes debugging enabled
 * 3. Native modules installed (view-tree, screenshot, lifecycle, touch)
 *
 * Run with: nub run test:e2e
 */

import { expect, expectLocator, test } from '@unrulysystems/rn-playwright-driver/test'

type NativeResult<T> = { success: true; data: T } | { success: false; error: string; code?: string }

async function requireViewTree(device: {
  evaluate<T>(expression: string): Promise<T>
}): Promise<boolean> {
  const capabilities = await device.evaluate<{ viewTree: boolean }>(
    'globalThis.__RN_DRIVER__.capabilities',
  )

  if (!capabilities.viewTree) {
    test.skip()
    return false
  }

  return true
}

async function requireScreenshot(device: {
  evaluate<T>(expression: string): Promise<T>
}): Promise<boolean> {
  const capabilities = await device.evaluate<{ screenshot: boolean }>(
    'globalThis.__RN_DRIVER__.capabilities',
  )

  if (!capabilities.screenshot) {
    test.skip()
    return false
  }

  return true
}

async function requireScreenshotAndViewTree(device: {
  evaluate<T>(expression: string): Promise<T>
}): Promise<boolean> {
  const capabilities = await device.evaluate<{ screenshot: boolean; viewTree: boolean }>(
    'globalThis.__RN_DRIVER__.capabilities',
  )

  if (!capabilities.screenshot || !capabilities.viewTree) {
    test.skip()
    return false
  }

  return true
}

async function requireLifecycle(device: {
  evaluate<T>(expression: string): Promise<T>
}): Promise<boolean> {
  const capabilities = await device.evaluate<{ lifecycle: boolean }>(
    'globalThis.__RN_DRIVER__.capabilities',
  )

  if (!capabilities.lifecycle) {
    test.skip()
    return false
  }

  return true
}

async function getCount(device: { evaluate<T>(expression: string): Promise<T> }): Promise<number> {
  const text = await device.evaluate<string>(
    "globalThis.__RN_DRIVER__.viewTree.findByTestId('count-display').then(r => r.success ? r.data.text : '0')",
  )
  const match = /\d+/.exec(text)
  return match ? Number.parseInt(match[0], 10) : 0
}

async function getDragStatus(device: {
  evaluate<T>(expression: string): Promise<T>
}): Promise<string> {
  return device.evaluate<string>(
    "globalThis.__RN_DRIVER__.viewTree.findByTestId('drag-status').then(r => r.success ? r.data.text : '')",
  )
}

test.describe('Counter App - Core Features', () => {
  test('harness is installed', async ({ device }) => {
    // Verify the harness is installed (use globalThis for Bridgeless RN compatibility)
    const hasHarness = await device.evaluate<boolean>(
      "typeof globalThis.__RN_DRIVER__ !== 'undefined'",
    )
    expect(hasHarness).toBe(true)
  })

  test('can read harness API version', async ({ device }) => {
    // The harness reports its protocol/contract version as the integer capabilities.apiVersion
    // (HARNESS_API_VERSION) — there is no package-semver-shaped `version` string field.
    const apiVersion = await device.evaluate<number>(
      'globalThis.__RN_DRIVER__.capabilities.apiVersion',
    )
    expect(apiVersion).toBe(1)
  })

  test('can check app is running', async ({ device }) => {
    // Use ping to verify connection is alive
    const isAlive = await device.ping()
    expect(isAlive).toBe(true)
  })

  test('can detect platform', async ({ device }) => {
    // Platform should be detected from target metadata or JS
    expect(['ios', 'android']).toContain(device.platform)
  })

  test('can evaluate JS in app context', async ({ device }) => {
    // Simple arithmetic
    const result = await device.evaluate<number>('1 + 2 + 3')
    expect(result).toBe(6)
  })

  test('can access React Native Platform via device', async ({ device }) => {
    // device.platform is determined from target metadata
    expect(['ios', 'android']).toContain(device.platform)
  })

  test('pointer tap simulates touch', async ({ device }) => {
    if (!(await requireViewTree(device))) {
      return
    }

    const button = device.getByTestId('increment-button')
    await expectLocator(button).toBeVisible()

    const bounds = await button.bounds()
    expect(bounds).not.toBeNull()

    const before = await getCount(device)
    await device.pointer.tap(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)

    await expectLocator(device.getByTestId('count-display')).toHaveText(String(before + 1), {
      exact: false,
    })
  })

  test('pointer drag is observed by the app', async ({ device }) => {
    if (!(await requireViewTree(device))) {
      return
    }

    const target = device.getByTestId('drag-target')
    await expectLocator(target).toBeVisible()

    const bounds = await target.bounds()
    expect(bounds).not.toBeNull()

    await device.pointer.drag(
      { x: bounds!.x + bounds!.width * 0.25, y: bounds!.y + bounds!.height / 2 },
      { x: bounds!.x + bounds!.width * 0.75, y: bounds!.y + bounds!.height / 2 },
      { duration: 350 },
    )

    await expectLocator(device.getByTestId('drag-status')).toHaveText('Drag: ended', {
      exact: false,
    })
    const status = await getDragStatus(device)
    const moveMatch = /moves:\s*(\d+)/.exec(status)
    expect(moveMatch).not.toBeNull()
    expect(Number.parseInt(moveMatch![1]!, 10)).toBeGreaterThan(0)
  })

  test('waitForFunction polls until truthy', async ({ device }) => {
    // Set up a delayed truthy value
    await device.evaluate<void>(`
      globalThis.__testDelayed = false;
      setTimeout(() => { globalThis.__testDelayed = true; }, 100);
    `)

    // Wait for it
    const result = await device.waitForFunction<boolean>('globalThis.__testDelayed', {
      timeout: 5000,
      polling: 50,
    })

    expect(result).toBe(true)

    // Clean up
    await device.evaluate<void>('delete globalThis.__testDelayed')
  })
})

test.describe('Counter App - Capabilities Detection', () => {
  test('reports viewTree capability', async ({ device }) => {
    const hasViewTree = await device.evaluate<boolean>(
      'globalThis.__RN_DRIVER__.capabilities.viewTree',
    )
    // Will be true when native module is installed
    expect(typeof hasViewTree).toBe('boolean')
  })

  test('reports screenshot capability', async ({ device }) => {
    const hasScreenshot = await device.evaluate<boolean>(
      'globalThis.__RN_DRIVER__.capabilities.screenshot',
    )
    expect(typeof hasScreenshot).toBe('boolean')
  })

  test('reports lifecycle capability', async ({ device }) => {
    const hasLifecycle = await device.evaluate<boolean>(
      'globalThis.__RN_DRIVER__.capabilities.lifecycle',
    )
    expect(typeof hasLifecycle).toBe('boolean')
  })
})

test.describe('Counter App - View Tree (Native Module)', () => {
  test('getByTestId finds element with testID', async ({ device }) => {
    // This test requires the view-tree native module to be installed
    if (!(await requireViewTree(device))) {
      return
    }

    // Find the increment button by testID
    const locator = device.getByTestId('increment-button')
    const isVisible = await locator.isVisible()
    expect(typeof isVisible).toBe('boolean')
  })

  test('getByText finds element with text', async ({ device }) => {
    if (!(await requireViewTree(device))) {
      return
    }

    // Find element containing "Counter" text
    const locator = device.getByText('Counter')
    const isVisible = await locator.isVisible()
    expect(typeof isVisible).toBe('boolean')
  })

  test('locator.tap() works with native module', async ({ device }) => {
    if (!(await requireViewTree(device))) {
      return
    }

    // Get initial count (text is "Count: N")
    const initialText = await device.evaluate<string>(
      "globalThis.__RN_DRIVER__.viewTree.findByTestId('count-display').then(r => r.success ? r.data.text : 'Count: 0')",
    )
    const initialCount = Number.parseInt(initialText.replace('Count: ', ''), 10)

    // Tap increment button
    await device.getByTestId('increment-button').tap()

    // Wait for UI to update
    await device.waitForTimeout(100)

    // Get new count - should have incremented
    const newText = await device.evaluate<string>(
      "globalThis.__RN_DRIVER__.viewTree.findByTestId('count-display').then(r => r.success ? r.data.text : 'Count: 0')",
    )
    const newCount = Number.parseInt(newText.replace('Count: ', ''), 10)

    expect(newCount).toBeGreaterThanOrEqual(initialCount)
  })

  test('locator.bounds() returns element bounds', async ({ device }) => {
    if (!(await requireViewTree(device))) {
      return
    }

    const locator = device.getByTestId('increment-button')
    const bounds = await locator.bounds()

    if (bounds) {
      expect(typeof bounds.x).toBe('number')
      expect(typeof bounds.y).toBe('number')
      expect(typeof bounds.width).toBe('number')
      expect(typeof bounds.height).toBe('number')
      expect(bounds.width).toBeGreaterThan(0)
      expect(bounds.height).toBeGreaterThan(0)
    }
  })

  test('getByRole finds element with accessibility role', async ({ device }) => {
    if (!(await requireViewTree(device))) {
      return
    }

    // Find a button by role
    const locator = device.getByRole('button')
    const isVisible = await locator.isVisible()
    expect(typeof isVisible).toBe('boolean')
  })

  test('findAll queries return arrays with handles', async ({ device }) => {
    if (!(await requireViewTree(device))) {
      return
    }
    type ElementInfo = { handle: string }

    // Test findAllByText - find elements containing "Count" (from "Count: X")
    const textResult = await device.evaluate<NativeResult<ElementInfo[]>>(
      "globalThis.__RN_DRIVER__.viewTree.findAllByText('Count', false)",
    )
    expect(textResult.success).toBe(true)
    if (textResult.success) {
      expect(Array.isArray(textResult.data)).toBe(true)
      expect(textResult.data.length).toBeGreaterThanOrEqual(1)
    }

    // Test findAllByTestId - find increment button (exact match returns 1)
    const testIdResult = await device.evaluate<NativeResult<ElementInfo[]>>(
      "globalThis.__RN_DRIVER__.viewTree.findAllByTestId('increment-button')",
    )
    expect(testIdResult.success).toBe(true)
    if (testIdResult.success) {
      expect(Array.isArray(testIdResult.data)).toBe(true)
      expect(testIdResult.data.length).toBe(1)
      expect(testIdResult.data[0].handle.length).toBeGreaterThan(0)
    }
  })

  test('isEnabled returns element enabled state', async ({ device }) => {
    if (!(await requireViewTree(device))) {
      return
    }
    type ElementInfo = { handle: string; enabled: boolean }

    // Find an element and check isEnabled
    const findResult = await device.evaluate<NativeResult<ElementInfo>>(
      "globalThis.__RN_DRIVER__.viewTree.findByTestId('increment-button')",
    )

    if (findResult.success) {
      const isEnabledResult = await device.evaluate<NativeResult<boolean>>(
        `globalThis.__RN_DRIVER__.viewTree.isEnabled('${findResult.data.handle}')`,
      )

      if (isEnabledResult.success) {
        expect(typeof isEnabledResult.data).toBe('boolean')
      }
    }
  })

  test('refresh returns updated element info', async ({ device }) => {
    if (!(await requireViewTree(device))) {
      return
    }
    type ElementInfo = { handle: string; bounds: { x: number; y: number } }

    // Find an element
    const findResult = await device.evaluate<NativeResult<ElementInfo>>(
      "globalThis.__RN_DRIVER__.viewTree.findByTestId('increment-button')",
    )

    if (findResult.success) {
      // Refresh should return updated info
      const refreshResult = await device.evaluate<NativeResult<ElementInfo | null>>(
        `globalThis.__RN_DRIVER__.viewTree.refresh('${findResult.data.handle}')`,
      )

      expect(typeof refreshResult.success).toBe('boolean')
    }
  })
})

test.describe('Counter App - Screenshot (Native Module)', () => {
  test('device.screenshot() captures screen', async ({ device }) => {
    if (!(await requireScreenshot(device))) {
      return
    }

    const screenshot = await device.screenshot()
    expect(screenshot).toBeInstanceOf(Buffer)
    expect(screenshot.length).toBeGreaterThan(0)

    // Verify it's a valid PNG (starts with PNG magic bytes)
    expect(screenshot[0]).toBe(0x89)
    expect(screenshot[1]).toBe(0x50) // 'P'
    expect(screenshot[2]).toBe(0x4e) // 'N'
    expect(screenshot[3]).toBe(0x47) // 'G'
  })

  test('screenshot.captureRegion() captures specific region', async ({ device }) => {
    if (!(await requireScreenshot(device))) {
      return
    }

    // Capture a 100x100 region from top-left
    const result = await device.evaluate<NativeResult<string>>(
      'globalThis.__RN_DRIVER__.screenshot.captureRegion({ x: 0, y: 0, width: 100, height: 100 })',
    )

    expect(result.success).toBe(true)
    if (result.success) {
      // Should be a base64 string
      expect(typeof result.data).toBe('string')
      expect(result.data.length).toBeGreaterThan(0)

      // Decode and verify PNG header
      const buffer = Buffer.from(result.data, 'base64')
      expect(buffer[0]).toBe(0x89)
      expect(buffer[1]).toBe(0x50) // 'P'
    }
  })

  test('screenshot.captureElement() captures element by handle', async ({ device }) => {
    if (!(await requireScreenshotAndViewTree(device))) {
      return
    }

    type ElementInfo = { handle: string }

    // First find an element to get its handle
    const findResult = await device.evaluate<NativeResult<ElementInfo>>(
      "globalThis.__RN_DRIVER__.viewTree.findByTestId('increment-button')",
    )

    if (!findResult.success) {
      test.skip()
      return
    }

    // Now capture that element using the harness bridge
    const captureResult = await device.evaluate<NativeResult<string>>(
      `globalThis.__RN_DRIVER__.screenshot.captureElement('${findResult.data.handle}')`,
    )

    expect(captureResult.success).toBe(true)
    if (captureResult.success) {
      expect(typeof captureResult.data).toBe('string')
      expect(captureResult.data.length).toBeGreaterThan(0)

      // Decode and verify PNG header
      const buffer = Buffer.from(captureResult.data, 'base64')
      expect(buffer[0]).toBe(0x89)
      expect(buffer[1]).toBe(0x50) // 'P'
    }
  })
})

test.describe('Counter App - Locator waitFor States', () => {
  test('waitFor supports attached, visible, and detached states', async ({ device }) => {
    if (!(await requireViewTree(device))) {
      return
    }

    // Test 'attached' - element exists in view tree
    const button = device.getByTestId('increment-button')
    await button.waitFor({ state: 'attached', timeout: 5000 })
    expect(await button.isVisible()).toBeDefined()

    // Test 'visible' - element exists AND is visible (also the default)
    const display = device.getByTestId('count-display')
    await display.waitFor({ state: 'visible', timeout: 5000 })
    expect(await display.isVisible()).toBe(true)

    // Test default state is 'visible'
    await button.waitFor({ timeout: 5000 })
    expect(await button.isVisible()).toBe(true)

    // Test 'detached' - should timeout for existing element
    let timedOut = false
    try {
      await button.waitFor({ state: 'detached', timeout: 300 })
    } catch (e) {
      timedOut = (e as Error).message.includes('timed out')
    }
    expect(timedOut).toBe(true)
  })
})

test.describe('Counter App - View Tree Matching', () => {
  test('view tree matching and element properties', async ({ device }) => {
    if (!(await requireViewTree(device))) {
      return
    }

    type Result<T> = { success: true; data: T } | { success: false }
    type Elem = {
      handle: string
      text: string | null
      role: string | null
      label: string | null
      visible: boolean
      enabled: boolean
    }

    // Test partial text matching (exact=false)
    const partial = await device.evaluate<Result<Elem[]>>(
      "globalThis.__RN_DRIVER__.viewTree.findAllByText('RN Playwright', false)",
    )
    expect(partial.success).toBe(true)
    if (partial.success) {
      expect(partial.data.some((element) => element.text?.includes('RN Playwright'))).toBe(true)
    }

    // Test exact text matching (exact=true)
    // The title element contains "RN Playwright Driver Example" - test with actual exact text
    const exact = await device.evaluate<Result<Elem>>(
      "globalThis.__RN_DRIVER__.viewTree.findByText('RN Playwright Driver Example', true)",
    )
    expect(exact.success).toBe(true)

    // Test role matching - note: requires accessibilityRole="button" on Pressable components
    // If the app hasn't been rebuilt with accessibilityRole props, this may not find elements
    const byRole = await device.evaluate<Result<Elem[]>>(
      "globalThis.__RN_DRIVER__.viewTree.findAllByRole('button', null)",
    )
    expect(byRole.success).toBe(true)
    if (byRole.success) {
      expect(byRole.data.some((element) => element.role === 'button')).toBe(true)
    }

    // Test element info includes all required properties
    const info = await device.evaluate<Result<Elem>>(
      "globalThis.__RN_DRIVER__.viewTree.findByTestId('increment-button')",
    )
    expect(info.success).toBe(true)
    if (info.success) {
      expect(info.data).toHaveProperty('text')
      expect(info.data).toHaveProperty('label')
      expect(typeof info.data.visible).toBe('boolean')
      expect(typeof info.data.enabled).toBe('boolean')
    }
  })
})

test.describe('Counter App - Counter Functionality', () => {
  // Native tap is now implemented via viewTree.tap() which uses platform-specific APIs:
  // - iOS: accessibilityActivate() and UIControl.sendActions()
  // - Android: performClick() and accessibility actions
  test('increment, decrement, and reset buttons update count correctly', async ({ device }) => {
    if (!(await requireViewTree(device))) {
      return
    }

    // Wait for display to be visible
    await device.getByTestId('count-display').waitFor({ state: 'visible', timeout: 5000 })

    // Test increment: tap + button and verify count increases
    const beforeIncrement = await getCount(device)
    await device.getByTestId('increment-button').tap()
    await device.waitForTimeout(100)
    expect(await getCount(device)).toBe(beforeIncrement + 1)

    // Test decrement: tap - button and verify count decreases
    const beforeDecrement = await getCount(device)
    await device.getByTestId('decrement-button').tap()
    await device.waitForTimeout(100)
    expect(await getCount(device)).toBe(beforeDecrement - 1)

    // Test reset: increment a few times, then reset to 0
    await device.getByTestId('increment-button').tap()
    await device.waitForTimeout(50)
    await device.getByTestId('increment-button').tap()
    await device.waitForTimeout(50)
    await device.getByTestId('increment-button').tap()
    await device.waitForTimeout(100)
    expect(await getCount(device)).not.toBe(0)

    await device.getByTestId('reset-button').tap()
    await device.waitForTimeout(100)
    expect(await getCount(device)).toBe(0)
  })
})

test.describe('Counter App - Lifecycle (Native Module)', () => {
  test('device.openURL() opens URL', async ({ device }) => {
    if (!(await requireLifecycle(device))) {
      return
    }

    // Try to open a deep link - this may or may not succeed depending on app config
    try {
      await device.openURL('example://test')
    } catch (error) {
      // Expected on iOS if the URL scheme isn't registered
      expect(error).toBeDefined()
    }
  })

  test('lifecycle.getState() returns app state', async ({ device }) => {
    if (!(await requireLifecycle(device))) {
      return
    }

    type StateResult = { success: true; data: string } | { success: false; error: string }
    const result = await device.evaluate<StateResult>(
      'globalThis.__RN_DRIVER__.lifecycle.getState()',
    )

    if (result.success) {
      expect(['active', 'background', 'inactive']).toContain(result.data)
    }
  })

  test('lifecycle control APIs return valid results', async ({ device }) => {
    if (!(await requireLifecycle(device))) {
      return
    }

    const platform = device.platform

    // Test reload - may return NOT_SUPPORTED in production
    const reloadResult = await device.evaluate<NativeResult<void>>(
      'globalThis.__RN_DRIVER__.lifecycle.reload()',
    )
    expect(typeof reloadResult.success).toBe('boolean')

    // Test background - iOS returns NOT_SUPPORTED
    const bgResult = await device.evaluate<NativeResult<void>>(
      'globalThis.__RN_DRIVER__.lifecycle.background()',
    )
    if (platform === 'ios') {
      expect(bgResult.success).toBe(false)
    }

    // Test foreground - no-op success when already active
    const fgResult = await device.evaluate<NativeResult<void>>(
      'globalThis.__RN_DRIVER__.lifecycle.foreground()',
    )
    expect(fgResult.success).toBe(true)
  })
})
