// @0xbigboss/rn-driver-r3f - R3F integration for rn-playwright-driver
//
// This entry point is safe for app-side (Metro) imports.
// For Playwright test fixtures with device.r3f namespace,
// import from '@0xbigboss/rn-driver-r3f/test' instead.

// --- Helpers (test-side, but no Playwright dependency) ---
export type { LookupMethod, R3FLookupOptions } from "./helpers";
export { getR3FObjectPosition, tapR3FObject, verifyHitTarget } from "./helpers";
// --- Locator (test-side, but no Playwright dependency) ---
export type { R3FDeviceNamespace } from "./locator";
export { createR3FNamespace, R3FLocator } from "./locator";
// --- Components (app-side) ---
export type { TestBridgeProps } from "./TestBridge";
export { TestBridge } from "./TestBridge";

// --- Types ---
export type {
	R3FBridgeCapabilities,
	R3FDriverBridge,
	R3FHitResult,
	R3FObjectInfo,
	R3FPointerEventType,
	R3FScreenBounds,
	R3FScreenPosition,
} from "./types";
