/**
 * R3FTouchAdapter - Routes harness touch events through R3F's internal event system
 *
 * This adapter bridges the rn-playwright-driver harness pointer events to R3F's
 * pointer event system by calling R3F's internal event handlers directly.
 *
 * @example
 * ```tsx
 * import { Canvas } from '@react-three/fiber';
 * import { R3FTouchAdapter } from '@0xbigboss/rn-driver-r3f';
 *
 * function App() {
 *   return (
 *     <Canvas>
 *       {__DEV__ && <R3FTouchAdapter />}
 *       <MyScene />
 *     </Canvas>
 *   );
 * }
 * ```
 */

import type { TouchEvent } from "@0xbigboss/rn-playwright-driver/harness";
import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";

export type R3FTouchAdapterProps = {
	/**
	 * Adapter ID for multi-canvas support.
	 * Registers as 'r3f' (single canvas) or 'r3f:${id}' (multi-canvas).
	 */
	id?: string;
};

/**
 * Map harness touch event types to R3F handler names.
 */
const TOUCH_TYPE_TO_HANDLER = {
	down: "onPointerDown",
	move: "onPointerMove",
	up: "onPointerUp",
} as const;

/**
 * Create a synthetic DOM-like PointerEvent that R3F's event system expects.
 *
 * R3F's event handlers read offsetX/offsetY to compute NDC coordinates,
 * then do raycasting and call the appropriate React handlers on hit objects.
 */
/**
 * Mock target element for pointer capture.
 * R3F calls setPointerCapture/releasePointerCapture during drag operations.
 */
const mockTarget = {
	setPointerCapture: (_pointerId: number) => {
		// No-op: pointer capture is handled by R3F's internal state
	},
	releasePointerCapture: (_pointerId: number) => {
		// No-op: pointer release is handled by R3F's internal state
	},
};

function createSyntheticPointerEvent(touchEvent: TouchEvent, pointerId: number): PointerEvent {
	let defaultPrevented = false;

	// Create a minimal PointerEvent-like object that R3F's event system expects.
	// R3F reads offsetX/offsetY to compute NDC, then does raycasting.
	const event = {
		// Position in canvas coordinates (R3F uses offsetX/offsetY)
		offsetX: touchEvent.x,
		offsetY: touchEvent.y,
		clientX: touchEvent.x,
		clientY: touchEvent.y,
		pageX: touchEvent.x,
		pageY: touchEvent.y,

		// Pointer identification
		pointerId,
		pointerType: "touch" as const,
		isPrimary: true,

		// Button state (0 = left/primary button)
		button: 0,
		buttons: touchEvent.type === "up" ? 0 : 1,

		// Target element with pointer capture methods (required for drag operations)
		target: mockTarget,
		currentTarget: mockTarget,

		// Event control methods
		stopPropagation: () => {
			// R3F calls this to stop event propagation
		},
		preventDefault: () => {
			defaultPrevented = true;
		},
		get defaultPrevented() {
			return defaultPrevented;
		},
	};

	return event as unknown as PointerEvent;
}

export function R3FTouchAdapter({ id }: R3FTouchAdapterProps): null {
	// Access R3F's internal event handlers via useThree
	// events.handlers contains onPointerDown, onPointerMove, onPointerUp, etc.
	const events = useThree((state) => state.events);

	// Track active pointer ID for gesture continuity
	const pointerIdRef = useRef<number>(1);

	useEffect(() => {
		if (!globalThis.__RN_DRIVER__) return;

		const handler = (touchEvent: TouchEvent): void => {
			// Get the appropriate R3F handler based on touch event type
			const handlerName = TOUCH_TYPE_TO_HANDLER[touchEvent.type];
			const r3fHandler = events.handlers?.[handlerName];

			if (!r3fHandler) {
				// R3F events not initialized yet
				return;
			}

			// Use consistent pointer ID for the gesture
			const pointerId = pointerIdRef.current;

			// Create synthetic event that R3F's event system expects
			const syntheticEvent = createSyntheticPointerEvent(touchEvent, pointerId);

			// Call R3F's internal event handler
			// This triggers R3F's full event flow:
			// 1. compute() converts offsetX/offsetY to NDC
			// 2. raycaster.setFromCamera() sets up the ray
			// 3. intersect() finds hit objects
			// 4. onIntersect() calls React handlers (onPointerDown, etc.)
			r3fHandler(syntheticEvent as PointerEvent);

			// Increment pointer ID after up event for next gesture
			if (touchEvent.type === "up") {
				pointerIdRef.current += 1;
			}
		};

		// Register with unique key for multi-canvas support
		const handlerKey = id ? `r3f:${id}` : "r3f";
		globalThis.__RN_DRIVER__.registerTouchHandler(handlerKey, handler);

		return () => {
			globalThis.__RN_DRIVER__?.unregisterTouchHandler(handlerKey);
		};
	}, [events, id]);

	return null;
}
