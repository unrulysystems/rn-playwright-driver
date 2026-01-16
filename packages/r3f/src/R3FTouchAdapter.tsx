/**
 * R3FTouchAdapter - Routes harness touch events through R3F raycasting
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
import { useEffect } from "react";
import type { Camera, PerspectiveCamera } from "three";
import { Vector2 } from "three";

export type R3FTouchAdapterProps = {
	/**
	 * Adapter ID for multi-canvas support.
	 * Registers as 'r3f' (single canvas) or 'r3f:${id}' (multi-canvas).
	 */
	id?: string;
};

export function R3FTouchAdapter({ id }: R3FTouchAdapterProps): null {
	const { camera, raycaster, scene, size } = useThree();

	useEffect(() => {
		if (!globalThis.__RN_DRIVER__) return;

		const { width, height } = size;

		/**
		 * Convert screen coords to NDC using R3F state.size.
		 */
		const screenToNdc = (x: number, y: number): Vector2 =>
			new Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1);

		const handler = (event: TouchEvent): void => {
			const ndc = screenToNdc(event.x, event.y);

			scene.updateMatrixWorld(true);
			camera.updateMatrixWorld();
			if ("updateProjectionMatrix" in camera) {
				(camera as PerspectiveCamera).updateProjectionMatrix();
			}

			raycaster.setFromCamera(ndc, camera as Camera);
			const intersects = raycaster.intersectObjects(scene.children, true);

			if (intersects.length > 0) {
				const hit = intersects[0];
				const eventType =
					event.type === "down" ? "pointerdown" : event.type === "up" ? "pointerup" : "pointermove";

				// Dispatch R3F-style pointer event
				// Note: Three.js Object3D.dispatchEvent is generic; R3F extends the event types
				// at runtime but TypeScript doesn't know about them, so we cast via unknown.
				hit.object.dispatchEvent({
					type: eventType,
					point: hit.point,
					distance: hit.distance,
					object: hit.object,
					clientX: event.x,
					clientY: event.y,
					pageX: event.x,
					pageY: event.y,
				} as unknown as Parameters<typeof hit.object.dispatchEvent>[0]);
			}
		};

		// Register with unique key for multi-canvas support
		const handlerKey = id ? `r3f:${id}` : "r3f";
		globalThis.__RN_DRIVER__.registerTouchHandler(handlerKey, handler);

		return () => {
			globalThis.__RN_DRIVER__?.unregisterTouchHandler(handlerKey);
		};
	}, [camera, raycaster, scene, size, id]);

	return null;
}
