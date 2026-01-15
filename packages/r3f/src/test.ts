/**
 * R3F Test Fixtures - Playwright fixtures with R3F support
 *
 * Extends the base rn-playwright-driver fixtures with `device.r3f` namespace
 * for testing React Three Fiber scenes.
 *
 * @example
 * ```typescript
 * import { test, expect } from '@0xbigboss/rn-driver-r3f/test';
 *
 * test('tap 3D object', async ({ device }) => {
 *   const cube = device.r3f.getByTestId('my-cube');
 *   await cube.tap();
 *   expect(await cube.isOnScreen()).toBe(true);
 * });
 * ```
 */

import type { Device } from "@0xbigboss/rn-playwright-driver";
import { test as baseTest, expect, expectLocator } from "@0xbigboss/rn-playwright-driver/test";
import { createR3FNamespace, type R3FDeviceNamespace } from "./locator";

/**
 * Device with R3F namespace attached.
 */
export type R3FDevice = Device & {
	/** R3F scene testing methods */
	r3f: R3FDeviceNamespace;
};

/**
 * Test fixtures with R3F-enabled device.
 */
export type R3FTestFixtures = {
	/** Device with R3F namespace for testing Three.js scenes */
	device: R3FDevice;
};

/**
 * Extend device with R3F namespace.
 * Can be used standalone without the fixture if needed.
 */
export function withR3F(device: Device): R3FDevice {
	return Object.assign(device, {
		r3f: createR3FNamespace(device),
	});
}

/**
 * Playwright test with R3F-enabled device fixture.
 *
 * Use this instead of the base test when testing React Three Fiber scenes.
 * Provides `device.r3f` namespace for 3D object interaction.
 *
 * @example
 * ```typescript
 * import { test, expect } from '@0xbigboss/rn-driver-r3f/test';
 *
 * test('scene interaction', async ({ device }) => {
 *   // R3F-specific methods
 *   await device.r3f.tap('cube');
 *   const sphere = device.r3f.getByTestId('sphere');
 *   await sphere.tap();
 *
 *   // Regular device methods still work
 *   await device.getByTestId('button').tap();
 * });
 * ```
 */
export const test = baseTest.extend<R3FTestFixtures>({
	device: async ({ device: baseDevice }, use) => {
		await use(withR3F(baseDevice));
	},
});

// Re-export expect utilities
export { expect, expectLocator };

// Re-export locator types for consumers
export { type R3FDeviceNamespace, R3FLocator } from "./locator";
