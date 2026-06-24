import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ElementInfo, NativeResult } from '@unrulysystems/rn-driver-shared-types'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import type { LocatorImpl } from './locator'
import type { Locator } from './types'

/** Default timeout for assertions in milliseconds */
const DEFAULT_ASSERTION_TIMEOUT = 5000

/** Polling interval for assertions in milliseconds */
const POLLING_INTERVAL = 100

/** Options for assertion methods */
export interface AssertionOptions {
  /** Timeout in milliseconds (default: 5000) */
  timeout?: number
  /** Polling interval in milliseconds (default: 100) */
  interval?: number
}

/** Options for text assertions */
export interface TextAssertionOptions extends AssertionOptions {
  /** Whether to match text exactly (default: false for substring match) */
  exact?: boolean
}

/** Options for snapshot assertions */
export interface SnapshotOptions {
  /** Maximum allowed pixel difference (0-1, default: 0) */
  maxDiffPixelRatio?: number
  /** Custom snapshot name (default: auto-generated from test context) */
  name?: string
  /** Directory to store snapshots (default: __snapshots__ next to test file) */
  snapshotsDir?: string
  /** Whether to update the snapshot if it differs (default: false) */
  updateSnapshots?: boolean
}

/**
 * Error thrown when an assertion fails.
 */
export class AssertionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssertionError'
  }
}

/**
 * Locator assertions with auto-retry.
 * These methods poll the locator until the assertion passes or times out.
 */
export interface LocatorAssertions {
  /**
   * Assert that element is visible.
   * Polls until element is visible or timeout.
   */
  toBeVisible(options?: AssertionOptions): Promise<void>

  /**
   * Assert that element is not visible.
   * Polls until element is hidden/detached or timeout.
   */
  not: {
    toBeVisible(options?: AssertionOptions): Promise<void>
    toBeEnabled(options?: AssertionOptions): Promise<void>
    toHaveText(text: string, options?: TextAssertionOptions): Promise<void>
  }

  /**
   * Assert that element contains text.
   * @param text - Text to match (substring unless exact: true)
   */
  toHaveText(text: string, options?: TextAssertionOptions): Promise<void>

  /**
   * Assert that element is enabled.
   */
  toBeEnabled(options?: AssertionOptions): Promise<void>

  /**
   * Assert that element is disabled.
   */
  toBeDisabled(options?: AssertionOptions): Promise<void>

  /**
   * Assert that element is attached to the DOM (exists in view tree).
   */
  toBeAttached(options?: AssertionOptions): Promise<void>

  /**
   * Assert that element screenshot matches a saved baseline.
   * Creates baseline on first run; compares on subsequent runs.
   *
   * @example
   * ```typescript
   * // With name as string
   * await expect(locator).toMatchSnapshot("button-default.png");
   *
   * // With options object
   * await expect(locator).toMatchSnapshot({ name: 'button-default', maxDiffPixelRatio: 0.01 });
   *
   * // Without name - uses locator.toString() to derive deterministic name
   * await expect(device.getByTestId("submit-btn")).toMatchSnapshot();
   * // Creates snapshot named: "Locator_testId_submit-btn_.png"
   * ```
   */
  toMatchSnapshot(nameOrOptions?: string | SnapshotOptions): Promise<void>
}

type ImageCompareResult =
  | { passed: true }
  | { passed: false; diffPixelRatio: number; diffImage?: Buffer; sizeMismatch?: SizeMismatch }

type SizeMismatch = {
  baseline: { width: number; height: number }
  actual: { width: number; height: number }
}

/**
 * Compare two PNG images using pixel-level comparison via pixelmatch.
 * Returns the ratio of differing pixels to total pixels.
 * Fails immediately if image dimensions differ.
 */
function compareImages(baseline: Buffer, actual: Buffer, maxDiffRatio: number): ImageCompareResult {
  // Parse PNG images
  const baselinePng = PNG.sync.read(baseline)
  const actualPng = PNG.sync.read(actual)

  // Fail immediately on any dimension mismatch - different sizes cannot be meaningfully compared
  if (baselinePng.width !== actualPng.width || baselinePng.height !== actualPng.height) {
    return {
      passed: false,
      diffPixelRatio: 1, // 100% different - incomparable
      sizeMismatch: {
        baseline: { width: baselinePng.width, height: baselinePng.height },
        actual: { width: actualPng.width, height: actualPng.height },
      },
    }
  }

  const { width, height } = baselinePng
  const totalPixels = width * height

  // Create diff image buffer
  const diffPng = new PNG({ width, height })

  // Compare using pixelmatch
  const numDiffPixels = pixelmatch(
    baselinePng.data,
    actualPng.data,
    diffPng.data,
    width,
    height,
    { threshold: 0.1 }, // Per-pixel color threshold
  )

  const diffRatio = numDiffPixels / totalPixels

  if (diffRatio > maxDiffRatio) {
    // Encode diff image for saving
    const diffBuffer = PNG.sync.write(diffPng)
    return { passed: false, diffPixelRatio: diffRatio, diffImage: diffBuffer }
  }

  return { passed: true }
}

/**
 * Create locator assertions for the given locator.
 */
function createLocatorAssertions(locator: Locator): LocatorAssertions {
  // Cast to LocatorImpl to access getElementInfo method
  const locatorImpl = locator as LocatorImpl

  type FailedResult = Extract<NativeResult<ElementInfo>, { success: false }>

  const queryElement = async (): Promise<NativeResult<ElementInfo>> => {
    // Use the locator's getElementInfo method to get real element data
    // including text, enabled state, etc.
    try {
      return await locatorImpl.getElementInfo()
    } catch {
      return { success: false, error: 'Element not found', code: 'NOT_FOUND' }
    }
  }

  const pollUntil = async <T>(
    predicate: () => Promise<{ passed: boolean; value?: T; error?: string }>,
    options?: AssertionOptions,
  ): Promise<T | undefined> => {
    const timeout = options?.timeout ?? DEFAULT_ASSERTION_TIMEOUT
    const interval = options?.interval ?? POLLING_INTERVAL
    const startTime = Date.now()

    let lastError: string | undefined

    while (Date.now() - startTime < timeout) {
      const result = await predicate()
      if (result.passed) {
        return result.value
      }
      lastError = result.error
      await new Promise((resolve) => setTimeout(resolve, interval))
    }

    throw new AssertionError(lastError ?? `Assertion timed out after ${timeout}ms`)
  }

  const pollElementAssertion = async (
    evaluate: (element: ElementInfo) => { passed: boolean; error?: string },
    options?: AssertionOptions,
    onMissing?: (result: FailedResult) => { passed: boolean; error?: string },
  ): Promise<void> => {
    await pollUntil(async () => {
      const result = await queryElement()
      if (!result.success) {
        if (onMissing) {
          return onMissing(result)
        }
        return { passed: false, error: 'Element not found' }
      }
      return evaluate(result.data)
    }, options)
  }

  const buildTextAssertion = (
    text: string,
    options: TextAssertionOptions | undefined,
    expectMatch: boolean,
    includeActual: boolean,
  ): ((element: ElementInfo) => { passed: boolean; error?: string }) => {
    return (element) => {
      const elementText = element.text ?? ''
      const hasText = options?.exact ? elementText === text : elementText.includes(text)
      const passed = expectMatch ? hasText : !hasText
      if (expectMatch) {
        const error = includeActual
          ? `Expected element to have text "${text}", got "${elementText}"`
          : `Expected element to have text "${text}"`
        return { passed, error }
      }
      return { passed, error: `Expected element to not have text "${text}"` }
    }
  }

  return {
    async toBeVisible(options?: AssertionOptions): Promise<void> {
      await pollElementAssertion(
        (element) => ({
          passed: element.visible,
          error: 'Expected element to be visible',
        }),
        options,
        (result) => {
          // NOT_FOUND should keep polling (element may appear)
          if (result.code === 'NOT_FOUND') {
            return { passed: false, error: 'Expected element to be visible' }
          }
          // Other errors (MULTIPLE_FOUND, NOT_SUPPORTED, etc.) surface the error
          return { passed: false, error: result.error }
        },
      )
    },

    not: {
      async toBeVisible(options?: AssertionOptions): Promise<void> {
        await pollElementAssertion(
          (element) => ({
            passed: !element.visible,
            error: 'Expected element to not be visible',
          }),
          options,
          (result) => {
            // NOT_FOUND means element doesn't exist, so it's not visible - pass
            if (result.code === 'NOT_FOUND') {
              return { passed: true }
            }
            // Other errors (INTERNAL, MULTIPLE_FOUND, etc.) should fail with the error
            return { passed: false, error: result.error }
          },
        )
      },

      async toBeEnabled(options?: AssertionOptions): Promise<void> {
        await pollElementAssertion(
          (element) => ({
            passed: !element.enabled,
            error: 'Expected element to not be enabled',
          }),
          options,
        )
      },

      async toHaveText(text: string, options?: TextAssertionOptions): Promise<void> {
        await pollElementAssertion(buildTextAssertion(text, options, false, false), options)
      },
    },

    async toHaveText(text: string, options?: TextAssertionOptions): Promise<void> {
      await pollElementAssertion(buildTextAssertion(text, options, true, true), options)
    },

    async toBeEnabled(options?: AssertionOptions): Promise<void> {
      await pollElementAssertion(
        (element) => ({
          passed: element.enabled,
          error: 'Expected element to be enabled',
        }),
        options,
      )
    },

    async toBeDisabled(options?: AssertionOptions): Promise<void> {
      await pollElementAssertion(
        (element) => ({
          passed: !element.enabled,
          error: 'Expected element to be disabled',
        }),
        options,
      )
    },

    async toBeAttached(options?: AssertionOptions): Promise<void> {
      await pollUntil(async () => {
        const bounds = await locator.bounds()
        return {
          passed: bounds !== null,
          error: 'Expected element to be attached',
        }
      }, options)
    },

    async toMatchSnapshot(nameOrOptions?: string | SnapshotOptions): Promise<void> {
      // Normalize arguments: string becomes { name: string }, undefined uses locator name
      const options: SnapshotOptions =
        typeof nameOrOptions === 'string'
          ? { name: nameOrOptions.replace(/\.png$/i, '') }
          : (nameOrOptions ?? {})

      // Get screenshot
      const screenshot = await locator.screenshot()

      // Determine snapshot name - use locator.toString() as deterministic default
      // Convert "Locator(testId="foo")" to "Locator_testId_foo_" for valid filename
      const derivedName = locator.toString().replace(/[^a-zA-Z0-9_-]/g, '_')
      const snapshotName = options.name ?? derivedName
      const snapshotsDir = options.snapshotsDir ?? join(process.cwd(), '__snapshots__')
      const snapshotPath = join(snapshotsDir, `${snapshotName}.png`)

      // Check if we should update snapshots (via env var or option)
      const shouldUpdate = options?.updateSnapshots ?? process.env.UPDATE_SNAPSHOTS === 'true'

      // If baseline doesn't exist, create it
      if (!existsSync(snapshotPath)) {
        mkdirSync(dirname(snapshotPath), { recursive: true })
        writeFileSync(snapshotPath, screenshot)
        return // First run - baseline created
      }

      // Read baseline
      const baseline = readFileSync(snapshotPath)

      // Compare images
      const maxDiffRatio = options?.maxDiffPixelRatio ?? 0
      const diffResult = compareImages(baseline, screenshot, maxDiffRatio)

      if (!diffResult.passed) {
        if (shouldUpdate) {
          // Update baseline
          writeFileSync(snapshotPath, screenshot)
          return
        }

        // Save actual screenshot for debugging
        const actualPath = join(snapshotsDir, `${snapshotName}.actual.png`)
        writeFileSync(actualPath, screenshot)

        // Save diff image if available (pixelmatch visual diff)
        let diffPath: string | undefined
        if (diffResult.diffImage) {
          diffPath = join(snapshotsDir, `${snapshotName}.diff.png`)
          writeFileSync(diffPath, diffResult.diffImage)
        }

        // Build error message - different for size mismatch vs pixel diff
        let errorMessage: string
        if (diffResult.sizeMismatch) {
          const { baseline: b, actual: a } = diffResult.sizeMismatch
          errorMessage =
            `Snapshot size mismatch: baseline is ${b.width}x${b.height}, ` +
            `actual is ${a.width}x${a.height}. Actual saved to: ${actualPath}`
        } else {
          const diffPercent = (diffResult.diffPixelRatio * 100).toFixed(2)
          const maxPercent = (maxDiffRatio * 100).toFixed(2)
          errorMessage =
            `Snapshot mismatch: ${diffPercent}% pixel difference ` +
            `(max allowed: ${maxPercent}%). ` +
            `Actual saved to: ${actualPath}` +
            (diffPath ? `. Diff image: ${diffPath}` : '')
        }

        throw new AssertionError(errorMessage)
      }
    },
  }
}

/**
 * Create an expect wrapper for locators with Playwright-style assertions.
 *
 * @example
 * ```typescript
 * import { expect } from '@unrulysystems/rn-playwright-driver/test';
 *
 * // Assert visibility with auto-retry
 * await expect(locator).toBeVisible();
 *
 * // Assert text content
 * await expect(locator).toHaveText("Count: 5");
 *
 * // Assert with custom timeout
 * await expect(locator).toBeVisible({ timeout: 10000 });
 *
 * // Negative assertions
 * await expect(locator).not.toBeVisible();
 * ```
 */
export function expect(locator: Locator): LocatorAssertions {
  return createLocatorAssertions(locator)
}
