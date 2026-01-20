/**
 * Bounding rectangle in logical points.
 * Origin (0,0) is top-left of screen.
 */
export type ElementBounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

/**
 * Unique identifier for an element instance.
 * Format: "element_{16-char-hex}" (e.g., "element_a1b2c3d4e5f67890")
 */
export type ElementHandle = `element_${string}`;

/**
 * Element information returned from view tree queries.
 */
export type ElementInfo = {
	/** Stable handle for referencing this element */
	handle: ElementHandle;

	/** testID prop (iOS: accessibilityIdentifier) */
	testId: string | null;

	/** Visible text content */
	text: string | null;

	/** Accessibility role */
	role: string | null;

	/** Accessibility label */
	label: string | null;

	/** Bounding rectangle in logical points */
	bounds: ElementBounds;

	/** Whether element is currently visible on screen */
	visible: boolean;

	/** Whether element is enabled for interaction */
	enabled: boolean;
};

/**
 * Error codes for native module calls.
 */
export type ErrorCode =
	| "NOT_FOUND"
	| "MULTIPLE_FOUND"
	| "NOT_VISIBLE"
	| "NOT_ENABLED"
	| "TIMEOUT"
	| "INTERNAL"
	| "NOT_SUPPORTED"
	| "INVALID_URL"
	| "TAP_FAILED";

/**
 * Standard result wrapper for native module calls.
 */
export type NativeResult<T> =
	| { success: true; data: T }
	| { success: false; error: string; code: ErrorCode };
