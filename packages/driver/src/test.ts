import { test as base } from '@playwright/test'
import { createDevice, type RNDevice, type RNDeviceOptions } from './device'
import type { Device, TouchBackendConfig, TouchBackendType } from './types'

const DEFAULT_METRO_URL = 'http://localhost:8081'
const DEFAULT_TIMEOUT = 30_000
const DEFAULT_TOUCH_INSTRUMENTATION_PORT = 9999
const TOUCH_BACKENDS = [
  'cli',
  'instrumentation',
  'native-module',
  'xctest',
] as const satisfies readonly TouchBackendType[]

/**
 * Parse timeout string, returning undefined if invalid.
 */
function parseTimeout(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed
}

function isTouchBackend(value: string): value is TouchBackendType {
  return TOUCH_BACKENDS.includes(value as TouchBackendType)
}

function touchOptionsFromEnv(): TouchBackendConfig | undefined {
  const backend = process.env.RN_TOUCH_BACKEND
  if (!backend || !isTouchBackend(backend)) {
    return undefined
  }

  if (backend !== 'instrumentation') {
    return { mode: 'force', backend }
  }

  return {
    mode: 'force',
    backend,
    instrumentation: {
      port:
        parseTimeout(process.env.RN_TOUCH_INSTRUMENTATION_PORT) ??
        DEFAULT_TOUCH_INSTRUMENTATION_PORT,
    },
  }
}

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
 * - RN_TOUCH_INSTRUMENTATION_PORT: Instrumentation companion port when RN_TOUCH_BACKEND=instrumentation (default: 9999)
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
        timeout: parseTimeout(process.env.RN_TIMEOUT) ?? DEFAULT_TIMEOUT,
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

      const touch = touchOptionsFromEnv()
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
export { expect } from '@playwright/test'
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
