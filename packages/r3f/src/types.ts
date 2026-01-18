/**
 * R3F Driver Bridge Types
 *
 * All types are CDP-serializable (JSON) for use across the CDP boundary.
 */

/**
 * Serializable object descriptor (NOT the Three.js object itself).
 * Used instead of returning Object3D which cannot cross CDP boundary.
 */
export type R3FObjectInfo = {
	/** Object name (Three.js name property) */
	name: string;
	/** Object UUID (Three.js uuid property) - globally unique */
	uuid: string;
	/** Object type (e.g., "Mesh", "Group", "InstancedMesh") */
	type: string;
	/** Whether object is visible */
	visible: boolean;
	/** World position */
	worldPosition: { x: number; y: number; z: number };
	/** World quaternion */
	worldQuaternion: { x: number; y: number; z: number; w: number };
	/** World scale */
	worldScale: { x: number; y: number; z: number };
	/** User-defined testId from userData */
	testId: string | null;
};

/**
 * Screen position with depth and visibility info.
 */
export type R3FScreenPosition = {
	/** Screen X in logical points */
	x: number;
	/** Screen Y in logical points */
	y: number;
	/** Normalized depth (0 = near plane, 1 = far plane) */
	depth: number;
	/** Whether object center is within viewport bounds and frustum */
	isOnScreen: boolean;
	/** Whether object is within camera frustum (between near and far planes) */
	isInFrustum: boolean;
};

/**
 * Screen bounding box with visibility.
 */
export type R3FScreenBounds = {
	x: number;
	y: number;
	width: number;
	height: number;
	/** Whether any part of bounds is on screen */
	isOnScreen: boolean;
};

/**
 * Hit test result from raycasting.
 */
export type R3FHitResult = {
	/** Name of hit object */
	name: string;
	/** UUID of hit object */
	uuid: string;
	/** World-space intersection point */
	point: { x: number; y: number; z: number };
	/** Distance from camera */
	distance: number;
	/** testId from userData if present */
	testId: string | null;
};

/**
 * Bridge capability flags.
 */
export type R3FBridgeCapabilities = {
	/** Core bridge is available */
	core: true;
	/** Rapier physics queries available */
	rapier: boolean;
	/** Direct pointer dispatch available (bypasses PanResponder) */
	pointerDispatch: boolean;
};

/**
 * Pointer event type for dispatch.
 */
export type R3FPointerEventType = "down" | "move" | "up";

/**
 * Bridge global type - always includes capability detection.
 */
export type R3FDriverBridge = {
	/** Capability detection */
	capabilities: R3FBridgeCapabilities;

	// ── Object Queries ─────────────────────────────────────────────

	/**
	 * Get serializable info for object by name.
	 * Returns null if not found or if multiple objects share the name.
	 */
	getObjectInfo: (name: string) => R3FObjectInfo | null;

	/**
	 * Get object info by UUID (globally unique, no collision possible).
	 */
	getObjectInfoByUuid: (uuid: string) => R3FObjectInfo | null;

	/**
	 * Get object info by userData.testId.
	 */
	getObjectInfoByTestId: (testId: string) => R3FObjectInfo | null;

	/**
	 * Get all objects matching name (for when names aren't unique).
	 */
	getAllObjectsByName: (name: string) => R3FObjectInfo[];

	/**
	 * List all named objects in scene.
	 */
	getNamedObjects: () => Array<{ name: string; uuid: string; testId: string | null }>;

	// ── Screen Position Queries ────────────────────────────────────
	// All lookup methods enforce uniqueness: return null if 0 or 2+ matches.

	/**
	 * Get screen position by object name (must be unique).
	 */
	getObjectScreenPosition: (name: string) => R3FScreenPosition | null;

	/**
	 * Get screen position by UUID (always unique).
	 */
	getObjectScreenPositionByUuid: (uuid: string) => R3FScreenPosition | null;

	/**
	 * Get screen position by userData.testId (must be unique).
	 */
	getObjectScreenPositionByTestId: (testId: string) => R3FScreenPosition | null;

	/**
	 * Get screen bounding box by name (must be unique).
	 */
	getObjectBounds: (name: string) => R3FScreenBounds | null;

	/**
	 * Get screen bounding box by UUID (always unique).
	 */
	getObjectBoundsByUuid: (uuid: string) => R3FScreenBounds | null;

	/**
	 * Get screen bounding box by userData.testId (must be unique).
	 */
	getObjectBoundsByTestId: (testId: string) => R3FScreenBounds | null;

	// ── Hit Testing ────────────────────────────────────────────────

	/**
	 * Perform hit test at screen coordinates.
	 * Returns topmost hit object info, or null if nothing hit.
	 */
	hitTest: (x: number, y: number) => R3FHitResult | null;

	/**
	 * Perform hit test and return all intersected objects.
	 */
	hitTestAll: (x: number, y: number) => R3FHitResult[];

	// ── Pointer Dispatch (bypasses PanResponder) ─────────────────────

	/**
	 * Dispatch pointer event directly to R3F event system.
	 * Bypasses React Native's PanResponder for native touch injection.
	 *
	 * @param type - Event type: "down", "move", or "up"
	 * @param x - Screen X in logical points (canvas coordinates)
	 * @param y - Screen Y in logical points (canvas coordinates)
	 * @returns true if event was dispatched, false if not available
	 */
	dispatchPointer?: (type: R3FPointerEventType, x: number, y: number) => boolean;

	// ── Rapier Physics (when capabilities.rapier === true) ─────────

	/**
	 * Get physics body world position by name.
	 * Only available when rapier capability is true.
	 */
	getPhysicsBodyPosition?: (name: string) => { x: number; y: number; z: number } | null;

	/**
	 * Get physics body screen position.
	 */
	getPhysicsBodyScreenPosition?: (name: string) => R3FScreenPosition | null;

	/**
	 * Check if physics body is sleeping.
	 */
	isPhysicsBodySleeping?: (name: string) => boolean | null;
};

// Global type declarations
declare global {
	// eslint-disable-next-line no-var
	var __RN_DRIVER_R3F__: R3FDriverBridge | undefined;
	// eslint-disable-next-line no-var
	var __RN_DRIVER_R3F_REGISTRY__: Record<string, R3FDriverBridge> | undefined;
}
