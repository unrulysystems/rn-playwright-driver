/**
 * R3F Locator - Playwright-style locator for R3F objects
 */
import type { Device } from "@0xbigboss/rn-playwright-driver";
import type { LookupMethod, R3FLookupOptions } from "./helpers";
import type { R3FHitResult, R3FObjectInfo, R3FScreenBounds, R3FScreenPosition } from "./types";

/**
 * Locator for R3F scene objects. Provides a fluent API similar to Playwright locators.
 *
 * @example
 * ```typescript
 * const cube = device.r3f.getByTestId('my-cube');
 * await cube.tap();
 * const pos = await cube.screenPosition();
 * ```
 */
export class R3FLocator {
	constructor(
		private readonly device: Device,
		private readonly identifier: string,
		private readonly method: LookupMethod,
		private readonly canvasId?: string,
	) {}

	/**
	 * Get the bridge expression for evaluating R3F commands.
	 */
	private get bridge(): string {
		return this.canvasId
			? `globalThis.__RN_DRIVER_R3F_REGISTRY__?.[${JSON.stringify(this.canvasId)}]`
			: "globalThis.__RN_DRIVER_R3F__";
	}

	/**
	 * Get the method name suffix for this lookup method.
	 */
	private get methodSuffix(): string {
		switch (this.method) {
			case "uuid":
				return "ByUuid";
			case "testId":
				return "ByTestId";
			default:
				return "";
		}
	}

	/**
	 * Tap the object at its screen center.
	 * @throws Error if object not found, off-screen, or outside frustum
	 */
	async tap(): Promise<void> {
		const pos = await this.screenPosition();
		await this.device.pointer.tap(pos.x, pos.y);
	}

	/**
	 * Get the object's screen position (center point).
	 * @throws Error if object not found, off-screen, or outside frustum
	 */
	async screenPosition(): Promise<R3FScreenPosition> {
		const methodName = `getObjectScreenPosition${this.methodSuffix}`;
		const pos = await this.device.evaluate<R3FScreenPosition | null>(
			`${this.bridge}?.${methodName}(${JSON.stringify(this.identifier)})`,
		);

		if (!pos) {
			throw new Error(`R3F object not found (${this.method}): ${this.identifier}`);
		}
		if (!pos.isOnScreen) {
			throw new Error(`R3F object is off-screen: ${this.identifier}`);
		}
		if (!pos.isInFrustum) {
			throw new Error(`R3F object is outside camera frustum: ${this.identifier}`);
		}

		return pos;
	}

	/**
	 * Get the object's screen bounding box.
	 * @throws Error if object not found
	 */
	async bounds(): Promise<R3FScreenBounds> {
		const methodName = `getObjectBounds${this.methodSuffix}`;
		const bounds = await this.device.evaluate<R3FScreenBounds | null>(
			`${this.bridge}?.${methodName}(${JSON.stringify(this.identifier)})`,
		);

		if (!bounds) {
			throw new Error(`R3F object not found (${this.method}): ${this.identifier}`);
		}

		return bounds;
	}

	/**
	 * Get full object info (position, rotation, scale, visibility).
	 * @throws Error if object not found
	 */
	async info(): Promise<R3FObjectInfo> {
		const methodName = `getObjectInfo${this.methodSuffix}`;
		const info = await this.device.evaluate<R3FObjectInfo | null>(
			`${this.bridge}?.${methodName}(${JSON.stringify(this.identifier)})`,
		);

		if (!info) {
			throw new Error(`R3F object not found (${this.method}): ${this.identifier}`);
		}

		return info;
	}

	/**
	 * Check if the object is currently on screen (visible in viewport and frustum).
	 */
	async isOnScreen(): Promise<boolean> {
		const methodName = `getObjectScreenPosition${this.methodSuffix}`;
		const pos = await this.device.evaluate<R3FScreenPosition | null>(
			`${this.bridge}?.${methodName}(${JSON.stringify(this.identifier)})`,
		);
		return pos?.isOnScreen ?? false;
	}

	/**
	 * Check if the object exists in the scene.
	 */
	async exists(): Promise<boolean> {
		const methodName = `getObjectInfo${this.methodSuffix}`;
		const info = await this.device.evaluate<R3FObjectInfo | null>(
			`${this.bridge}?.${methodName}(${JSON.stringify(this.identifier)})`,
		);
		return info !== null;
	}
}

/**
 * R3F namespace methods attached to device.r3f
 */
export type R3FDeviceNamespace = {
	/**
	 * Get a locator for an object by its userData.testId.
	 */
	getByTestId(testId: string, canvasId?: string): R3FLocator;

	/**
	 * Get a locator for an object by its name.
	 * Note: Returns null if multiple objects have the same name.
	 */
	getByName(name: string, canvasId?: string): R3FLocator;

	/**
	 * Get a locator for an object by its UUID.
	 */
	getByUuid(uuid: string, canvasId?: string): R3FLocator;

	/**
	 * Tap an R3F object by identifier.
	 * Shorthand for getByTestId(id).tap()
	 */
	tap(identifier: string, options?: R3FLookupOptions): Promise<void>;

	/**
	 * Perform a hit test at screen coordinates.
	 * @returns The topmost hit object, or null if nothing hit
	 */
	hitTest(x: number, y: number, canvasId?: string): Promise<R3FHitResult | null>;

	/**
	 * Perform a hit test and return all intersected objects.
	 */
	hitTestAll(x: number, y: number, canvasId?: string): Promise<R3FHitResult[]>;

	/**
	 * Verify that a hit test at (x, y) returns the expected object.
	 * @throws Error if no hit or unexpected object hit
	 */
	verifyHit(x: number, y: number, expectedTestId: string, canvasId?: string): Promise<R3FHitResult>;
};

/**
 * Create the r3f namespace for a device.
 */
export function createR3FNamespace(device: Device): R3FDeviceNamespace {
	const getBridge = (canvasId?: string): string =>
		canvasId
			? `globalThis.__RN_DRIVER_R3F_REGISTRY__?.[${JSON.stringify(canvasId)}]`
			: "globalThis.__RN_DRIVER_R3F__";

	return {
		getByTestId(testId: string, canvasId?: string): R3FLocator {
			return new R3FLocator(device, testId, "testId", canvasId);
		},

		getByName(name: string, canvasId?: string): R3FLocator {
			return new R3FLocator(device, name, "name", canvasId);
		},

		getByUuid(uuid: string, canvasId?: string): R3FLocator {
			return new R3FLocator(device, uuid, "uuid", canvasId);
		},

		async tap(identifier: string, options?: R3FLookupOptions): Promise<void> {
			const { method = "testId", canvasId } = options ?? {};
			const locator = new R3FLocator(device, identifier, method, canvasId);
			await locator.tap();
		},

		async hitTest(x: number, y: number, canvasId?: string): Promise<R3FHitResult | null> {
			const bridge = getBridge(canvasId);
			return device.evaluate<R3FHitResult | null>(`${bridge}?.hitTest(${x}, ${y})`);
		},

		async hitTestAll(x: number, y: number, canvasId?: string): Promise<R3FHitResult[]> {
			const bridge = getBridge(canvasId);
			return device.evaluate<R3FHitResult[]>(`${bridge}?.hitTestAll(${x}, ${y}) ?? []`);
		},

		async verifyHit(
			x: number,
			y: number,
			expectedTestId: string,
			canvasId?: string,
		): Promise<R3FHitResult> {
			const hit = await this.hitTest(x, y, canvasId);

			if (!hit) {
				throw new Error(`No hit at (${x}, ${y})`);
			}
			if (hit.testId !== expectedTestId) {
				throw new Error(
					`Expected to hit testId='${expectedTestId}' but hit '${hit.name}' (testId: ${hit.testId})`,
				);
			}

			return hit;
		},
	};
}
