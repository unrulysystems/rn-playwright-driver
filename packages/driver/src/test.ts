import { test as base } from "@playwright/test";
import { createDevice, type RNDevice, type RNDeviceOptions } from "./device";
import type { Device } from "./types";

const DEFAULT_METRO_URL = "http://localhost:8081";
const DEFAULT_TIMEOUT = 30_000;

/**
 * Parse timeout string, returning undefined if invalid.
 */
function parseTimeout(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed;
}

/**
 * Extended test fixtures for React Native testing.
 */
export type RNTestFixtures = {
  /** Connected device instance (worker-scoped, shared across tests) */
  device: Device;
};

export type RNWorkerFixtures = {
  /** Device options resolved from environment */
  deviceOptions: RNDeviceOptions;
  /** Worker-scoped device instance */
  _workerDevice: RNDevice;
};

/**
 * Create a custom test with RN device fixture.
 *
 * Configure via environment variables:
 * - RN_METRO_URL: Metro bundler URL (default: 'http://localhost:8081')
 * - RN_DEVICE_ID: Device ID to connect to
 * - RN_DEVICE_NAME: Device name to match (substring, case-insensitive)
 * - RN_TIMEOUT: Request timeout in ms (default: 30000)
 * Usage in test files:
 * ```ts
 * import { test, expect } from '@0xbigboss/rn-playwright-driver/test';
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
    // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture pattern requires destructuring
    async ({}, use) => {
      const options: RNDeviceOptions = {
        metroUrl: process.env.RN_METRO_URL ?? DEFAULT_METRO_URL,
        timeout: parseTimeout(process.env.RN_TIMEOUT) ?? DEFAULT_TIMEOUT,
      };

      // Only set optional fields if they have values
      const deviceId = process.env.RN_DEVICE_ID;
      if (deviceId) {
        options.deviceId = deviceId;
      }

      const deviceName = process.env.RN_DEVICE_NAME;
      if (deviceName) {
        options.deviceName = deviceName;
      }

      await use(options);
    },
    { scope: "worker" },
  ],

  // Worker-scoped device - created once per worker
  _workerDevice: [
    async ({ deviceOptions }, use) => {
      const device = createDevice(deviceOptions);
      await device.connect();
      await use(device);
      await device.disconnect();
    },
    { scope: "worker" },
  ],

  // Test-scoped device reference (points to worker device)
  device: async ({ _workerDevice }, use) => {
    await use(_workerDevice);
  },
});

/**
 * Re-export expect from Playwright for convenience.
 */
export { expect } from "@playwright/test";
export type {
  AssertionOptions,
  LocatorAssertions,
  SnapshotOptions,
  TextAssertionOptions,
} from "./expect";
/**
 * Locator-specific assertions with auto-retry.
 * Use this for RN locator assertions instead of Playwright's expect.
 *
 * @example
 * ```ts
 * import { test, expectLocator } from '@0xbigboss/rn-playwright-driver/test';
 *
 * test('button is visible', async ({ device }) => {
 *   const button = device.getByTestId('submit-button');
 *   await expectLocator(button).toBeVisible();
 * });
 * ```
 */
export { AssertionError, expect as expectLocator } from "./expect";

/**
 * Type for the test function with RN fixtures.
 */
export type RNTest = typeof test;
