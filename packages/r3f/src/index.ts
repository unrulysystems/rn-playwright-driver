// @0xbigboss/rn-driver-r3f - R3F integration for rn-playwright-driver

// --- Helpers (test-side) ---
export type { LookupMethod, R3FLookupOptions } from "./helpers";
export { getR3FObjectPosition, tapR3FObject, verifyHitTarget } from "./helpers";
// --- Locator (test-side) ---
export type { R3FDeviceNamespace } from "./locator";
export { createR3FNamespace, R3FLocator } from "./locator";
export type { R3FTouchAdapterProps } from "./R3FTouchAdapter";
export { R3FTouchAdapter } from "./R3FTouchAdapter";
// --- Components (app-side) ---
export type { TestBridgeProps } from "./TestBridge";
export { TestBridge } from "./TestBridge";

// --- Device Extension ---
export type { R3FDevice, R3FTestFixtures } from "./test";
export { withR3F } from "./test";

// --- Types ---
export type {
	R3FBridgeCapabilities,
	R3FDriverBridge,
	R3FHitResult,
	R3FObjectInfo,
	R3FScreenBounds,
	R3FScreenPosition,
} from "./types";
