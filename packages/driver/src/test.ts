import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type * as PlaywrightTest from '@playwright/test'
import { createDevice, type RNDevice, type RNDeviceOptions } from './device'
import { parsePositiveInteger, touchOptionsFromEnv } from './test-env'
import type { Device } from './types'

const DEFAULT_METRO_URL = 'http://localhost:8081'
const DEFAULT_TIMEOUT = 30_000
const requireFromProject = createRequire(join(process.cwd(), 'package.json'))
const playwright = requireFromProject('@playwright/test') as typeof PlaywrightTest
const base = playwright.test

/**
 * Extended test fixtures for React Native testing.
 */
export type RNTestFixtures = {
  /** Connected device instance (worker-scoped, shared across tests) */
  device: Device
}

export type RNWorkerFixtures = {
  /** Device options resolved from environment */
  deviceOptions: RNDeviceOptions
  /** Worker-scoped device instance */
  _workerDevice: RNDevice
}

/**
 * Create a custom test with RN device fixture.
 *
 * Configure via environment variables:
 * - RN_METRO_URL: Metro bundler URL (default: 'http://localhost:8081')
 * - RN_DEVICE_ID: Device ID to connect to
 * - RN_DEVICE_NAME: Device name to match (substring, case-insensitive)
 * - RN_TIMEOUT: Request timeout in ms (default: 30000)
 * - RN_TOUCH_BACKEND: Force touch backend ('cli', 'instrumentation', 'native-module', or 'xctest')
 * - RN_TOUCH_CLI_ADB_PATH: adb executable path for RN_TOUCH_BACKEND=cli
 * - RN_TOUCH_ADB_SERIAL: adb serial for RN_TOUCH_BACKEND=cli (defaults to ANDROID_SERIAL or RN_DEVICE_ID)
 * - RN_TOUCH_INSTRUMENTATION_PORT: Instrumentation companion port when RN_TOUCH_BACKEND=instrumentation (default: 9999)
 * - RN_TOUCH_INSTRUMENTATION_TOKEN: Required auth token for the Android instrumentation companion
 * - RN_TOUCH_INSTRUMENTATION_TOKEN_FILE: File containing the auth token when RN_TOUCH_INSTRUMENTATION_TOKEN is unset
 * - RN_TOUCH_XCTEST_HOST / RN_TOUCH_XCTEST_PORT / RN_TOUCH_XCTEST_URL: XCTest companion endpoint
 * - RN_TOUCH_XCTEST_TOKEN / RN_TOUCH_XCTEST_TOKEN_FILE: XCTest companion auth token
 * Usage in test files:
 * ```ts
 * import { test, expect } from '@unrulysystems/rn-playwright-driver/test';
 *
 * test('app loads', async ({ device }) => {
 *   const result = await device.evaluate<number>('1 + 1');
 *   expect(result).toBe(2);
 * });
 * ```
 */
export const test = base.extend<RNTestFixtures, RNWorkerFixtures>({
  // Worker-scoped options from environment
  deviceOptions: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright fixture pattern requires destructuring
    async ({}, use) => {
      const options: RNDeviceOptions = {
        metroUrl: process.env.RN_METRO_URL ?? DEFAULT_METRO_URL,
        timeout: parsePositiveInteger(process.env.RN_TIMEOUT) ?? DEFAULT_TIMEOUT,
      }

      // Only set optional fields if they have values
      const deviceId = process.env.RN_DEVICE_ID
      if (deviceId) {
        options.deviceId = deviceId
      }

      const deviceName = process.env.RN_DEVICE_NAME
      if (deviceName) {
        options.deviceName = deviceName
      }

      const touch = touchOptionsFromEnv(process.env, (path) => readFileSync(path, 'utf8'), deviceId)
      if (touch) {
        options.touch = touch
      }

      await use(options)
    },
    { scope: 'worker' },
  ],

  // Worker-scoped device - created once per worker
  _workerDevice: [
    async ({ deviceOptions }, use) => {
      const device = createDevice(deviceOptions)
      await device.connect()
      await use(device)
      await device.disconnect()
    },
    { scope: 'worker' },
  ],

  // Test-scoped device reference (points to worker device)
  device: async ({ _workerDevice }, use) => {
    await use(_workerDevice)
  },
})

/**
 * Re-export expect from Playwright for convenience.
 */
export const { expect } = playwright
export type {
  AssertionOptions,
  LocatorAssertions,
  SnapshotOptions,
  TextAssertionOptions,
} from './expect'
/**
 * Locator-specific assertions with auto-retry.
 * Use this for RN locator assertions instead of Playwright's expect.
 *
 * @example
 * ```ts
 * import { test, expectLocator } from '@unrulysystems/rn-playwright-driver/test';
 *
 * test('button is visible', async ({ device }) => {
 *   const button = device.getByTestId('submit-button');
 *   await expectLocator(button).toBeVisible();
 * });
 * ```
 */
export { AssertionError, expect as expectLocator } from './expect'

/**
 * Type for the test function with RN fixtures.
 */
export type RNTest = typeof test
