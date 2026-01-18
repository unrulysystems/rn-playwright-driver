/**
 * TestBridge - Exposes R3F scene state to test harness
 *
 * @example
 * ```tsx
 * import { Canvas } from '@react-three/fiber';
 * import { TestBridge } from '@0xbigboss/rn-driver-r3f';
 *
 * function App() {
 *   return (
 *     <Canvas>
 *       {__DEV__ && <TestBridge />}
 *       <MyScene />
 *     </Canvas>
 *   );
 * }
 * ```
 */
import { createEvents, useStore, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { Camera, Object3D, PerspectiveCamera } from "three";
import { Box3, Quaternion, Vector2, Vector3 } from "three";
import type {
	R3FBridgeCapabilities,
	R3FDriverBridge,
	R3FHitResult,
	R3FObjectInfo,
	R3FPointerEventType,
	R3FScreenBounds,
	R3FScreenPosition,
} from "./types";

export type TestBridgeProps = {
	/**
	 * Canvas/bridge identifier for multi-canvas support.
	 * If multiple canvases exist, each needs a unique id.
	 * When id is provided, bridge is registered at global.__RN_DRIVER_R3F_REGISTRY__[id].
	 * Default (no id): bridge is at global.__RN_DRIVER_R3F__.
	 */
	id?: string;

	/**
	 * Enable Rapier physics body queries.
	 * Requires @react-three/rapier to be installed and RigidBody components
	 * to have name props or userData.testId.
	 */
	rapier?: boolean;
};

/**
 * TestBridge component - renders nothing, registers R3F scene bridge on global.
 */
export function TestBridge({ id, rapier = false }: TestBridgeProps): null {
	const { scene, camera, raycaster, size } = useThree();
	const store = useStore();
	const cacheRef = useRef<Map<string, Object3D>>(new Map());

	useEffect(() => {
		// Use R3F state.size for accurate canvas dimensions (logical points)
		const { width, height } = size;

		/**
		 * Ensure matrices are up-to-date before any projection.
		 * Critical for frameloop="demand" or after external camera changes.
		 */
		const updateMatrices = (): void => {
			scene.updateMatrixWorld(true);
			camera.updateMatrixWorld();
			if ("updateProjectionMatrix" in camera) {
				(camera as PerspectiveCamera).updateProjectionMatrix();
			}
		};

		/**
		 * Find object by UUID only (guaranteed unique).
		 */
		const findObjectByUuid = (uuid: string): Object3D | null => {
			const cached = cacheRef.current.get(`uuid:${uuid}`);
			if (cached?.parent) return cached;

			const obj = scene.getObjectByProperty("uuid", uuid);
			if (obj) {
				cacheRef.current.set(`uuid:${uuid}`, obj);
			}
			return obj ?? null;
		};

		/**
		 * Find object by testId (userData.testId). Returns null if 0 or 2+ matches.
		 */
		const findObjectByTestId = (testId: string): Object3D | null => {
			const matches: Object3D[] = [];
			scene.traverse((child) => {
				if (child.userData?.testId === testId) {
					matches.push(child);
				}
			});
			if (matches.length !== 1) return null; // Not found or ambiguous
			return matches[0];
		};

		/**
		 * Find object by name. Returns null if 0 or 2+ matches (ambiguous).
		 */
		const findObjectByName = (name: string): Object3D | null => {
			const matches: Object3D[] = [];
			scene.traverse((obj) => {
				if (obj.name === name) matches.push(obj);
			});
			if (matches.length !== 1) return null; // Not found or ambiguous
			return matches[0];
		};

		/**
		 * Project world position to screen with depth info.
		 *
		 * After projection, z values are in NDC:
		 *   z < -1: behind near plane (invalid)
		 *   -1 <= z <= 1: within view frustum
		 *   z > 1: beyond far plane (invalid)
		 */
		const projectToScreen = (worldPos: Vector3): R3FScreenPosition => {
			updateMatrices();
			const projected = worldPos.clone().project(camera as Camera);

			const x = ((projected.x + 1) / 2) * width;
			const y = ((-projected.y + 1) / 2) * height;
			const depth = (projected.z + 1) / 2; // Normalize to 0-1

			// In frustum: -1 <= z <= 1 (not behind near plane, not beyond far plane)
			const isInFrustum = projected.z >= -1 && projected.z <= 1;
			const isOnScreen = x >= 0 && x <= width && y >= 0 && y <= height && isInFrustum;

			return { x, y, depth, isOnScreen, isInFrustum };
		};

		/**
		 * Compute screen bounding box for an object.
		 */
		const computeBounds = (obj: Object3D): R3FScreenBounds | null => {
			updateMatrices();
			const box = new Box3().setFromObject(obj);
			if (box.isEmpty()) return null;

			// Project all 8 corners
			const corners = [
				new Vector3(box.min.x, box.min.y, box.min.z),
				new Vector3(box.max.x, box.min.y, box.min.z),
				new Vector3(box.min.x, box.max.y, box.min.z),
				new Vector3(box.max.x, box.max.y, box.min.z),
				new Vector3(box.min.x, box.min.y, box.max.z),
				new Vector3(box.max.x, box.min.y, box.max.z),
				new Vector3(box.min.x, box.max.y, box.max.z),
				new Vector3(box.max.x, box.max.y, box.max.z),
			];

			const screenPoints = corners.map((c) => projectToScreen(c));
			const xs = screenPoints.map((p) => p.x);
			const ys = screenPoints.map((p) => p.y);
			const anyOnScreen = screenPoints.some((p) => p.isOnScreen);

			return {
				x: Math.min(...xs),
				y: Math.min(...ys),
				width: Math.max(...xs) - Math.min(...xs),
				height: Math.max(...ys) - Math.min(...ys),
				isOnScreen: anyOnScreen,
			};
		};

		/**
		 * Convert object to serializable info.
		 */
		const toObjectInfo = (obj: Object3D): R3FObjectInfo => {
			updateMatrices();
			const worldPos = obj.getWorldPosition(new Vector3());
			const worldQuat = obj.getWorldQuaternion(new Quaternion());
			const worldScale = obj.getWorldScale(new Vector3());

			return {
				name: obj.name,
				uuid: obj.uuid,
				type: obj.type,
				visible: obj.visible,
				worldPosition: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
				worldQuaternion: { x: worldQuat.x, y: worldQuat.y, z: worldQuat.z, w: worldQuat.w },
				worldScale: { x: worldScale.x, y: worldScale.y, z: worldScale.z },
				testId: (obj.userData?.testId as string) ?? null,
			};
		};

		/**
		 * Convert screen coords to NDC for raycasting.
		 */
		const screenToNdc = (x: number, y: number): Vector2 =>
			new Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1);

		// Create R3F event handlers for direct pointer dispatch
		// This bypasses PanResponder and injects events directly into R3F's event system
		const { handlePointer } = createEvents(store);

		const capabilities: R3FBridgeCapabilities = {
			core: true,
			rapier,
			pointerDispatch: true,
		};

		const bridge: R3FDriverBridge = {
			capabilities,

			getObjectInfo: (name) => {
				// Check for uniqueness
				const matches: Object3D[] = [];
				scene.traverse((obj) => {
					if (obj.name === name) matches.push(obj);
				});
				if (matches.length !== 1) return null; // Not found or ambiguous
				return toObjectInfo(matches[0]);
			},

			getObjectInfoByUuid: (uuid) => {
				const obj = scene.getObjectByProperty("uuid", uuid);
				return obj ? toObjectInfo(obj) : null;
			},

			getObjectInfoByTestId: (testId) => {
				// Enforce uniqueness: return null if 0 or 2+ matches
				const obj = findObjectByTestId(testId);
				return obj ? toObjectInfo(obj) : null;
			},

			getAllObjectsByName: (name) => {
				const results: R3FObjectInfo[] = [];
				scene.traverse((obj) => {
					if (obj.name === name) results.push(toObjectInfo(obj));
				});
				return results;
			},

			getNamedObjects: () => {
				const results: Array<{ name: string; uuid: string; testId: string | null }> = [];
				scene.traverse((obj) => {
					if (obj.name) {
						results.push({
							name: obj.name,
							uuid: obj.uuid,
							testId: (obj.userData?.testId as string) ?? null,
						});
					}
				});
				return results;
			},

			getObjectScreenPosition: (name) => {
				const obj = findObjectByName(name);
				if (!obj) return null;
				return projectToScreen(obj.getWorldPosition(new Vector3()));
			},

			getObjectScreenPositionByUuid: (uuid) => {
				const obj = findObjectByUuid(uuid);
				if (!obj) return null;
				return projectToScreen(obj.getWorldPosition(new Vector3()));
			},

			getObjectScreenPositionByTestId: (testId) => {
				const obj = findObjectByTestId(testId);
				if (!obj) return null;
				return projectToScreen(obj.getWorldPosition(new Vector3()));
			},

			getObjectBounds: (name) => {
				const obj = findObjectByName(name);
				return obj ? computeBounds(obj) : null;
			},

			getObjectBoundsByUuid: (uuid) => {
				const obj = findObjectByUuid(uuid);
				return obj ? computeBounds(obj) : null;
			},

			getObjectBoundsByTestId: (testId) => {
				const obj = findObjectByTestId(testId);
				return obj ? computeBounds(obj) : null;
			},

			hitTest: (x, y) => {
				updateMatrices();
				const ndc = screenToNdc(x, y);
				raycaster.setFromCamera(ndc, camera as Camera);
				const hits = raycaster.intersectObjects(scene.children, true);

				if (hits.length === 0) return null;
				const hit = hits[0];
				return {
					name: hit.object.name,
					uuid: hit.object.uuid,
					point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
					distance: hit.distance,
					testId: (hit.object.userData?.testId as string) ?? null,
				};
			},

			hitTestAll: (x, y) => {
				updateMatrices();
				const ndc = screenToNdc(x, y);
				raycaster.setFromCamera(ndc, camera as Camera);
				const hits = raycaster.intersectObjects(scene.children, true);

				return hits.map(
					(hit): R3FHitResult => ({
						name: hit.object.name,
						uuid: hit.object.uuid,
						point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
						distance: hit.distance,
						testId: (hit.object.userData?.testId as string) ?? null,
					}),
				);
			},

			dispatchPointer: (type: R3FPointerEventType, x: number, y: number): boolean => {
				const eventNameMap: Record<R3FPointerEventType, string> = {
					down: "onPointerDown",
					move: "onPointerMove",
					up: "onPointerUp",
				};
				const eventName = eventNameMap[type];

				// Create synthetic event matching R3F's expected format
				// R3F's handleTouch transforms: offsetX = locationX, offsetY = locationY
				// Cast as unknown since R3F only uses a subset of PointerEvent properties
				const syntheticEvent = {
					offsetX: x,
					offsetY: y,
					pointerId: 1,
					pointerType: "touch",
					button: 0,
					buttons: type === "up" ? 0 : 1,
					clientX: x,
					clientY: y,
					pageX: x,
					pageY: y,
					preventDefault: () => {},
					stopPropagation: () => {},
				} as unknown as PointerEvent;

				try {
					handlePointer(eventName)(syntheticEvent);
					return true;
				} catch {
					return false;
				}
			},
		};

		// Add Rapier methods if enabled
		if (rapier) {
			// Rapier integration requires access to RapierContext
			// Users must ensure RigidBody components have name prop or userData.testId
			// Lookup: Find RigidBody by traversing scene and checking for rigidBody ref
			bridge.getPhysicsBodyPosition = (name) => {
				// Implementation note: Access via @react-three/rapier's RigidBody ref
				// The RigidBody stores its Rapier body in userData.__rapierRigidBody or similar
				let position: { x: number; y: number; z: number } | null = null;
				scene.traverse((obj) => {
					if (obj.name === name || obj.userData?.testId === name) {
						const body = obj.userData?.__rapierRigidBody as
							| { translation: () => { x: number; y: number; z: number } }
							| undefined;
						if (body && typeof body.translation === "function") {
							const t = body.translation();
							position = { x: t.x, y: t.y, z: t.z };
						}
					}
				});
				return position;
			};

			bridge.getPhysicsBodyScreenPosition = (name) => {
				const pos = bridge.getPhysicsBodyPosition?.(name);
				if (!pos) return null;
				return projectToScreen(new Vector3(pos.x, pos.y, pos.z));
			};

			bridge.isPhysicsBodySleeping = (name) => {
				let sleeping: boolean | null = null;
				scene.traverse((obj) => {
					if (obj.name === name || obj.userData?.testId === name) {
						const body = obj.userData?.__rapierRigidBody as
							| { isSleeping: () => boolean }
							| undefined;
						if (body && typeof body.isSleeping === "function") {
							sleeping = body.isSleeping();
						}
					}
				});
				return sleeping;
			};
		}

		// Register bridge
		if (id) {
			// Multi-canvas: use registry
			if (!global.__RN_DRIVER_R3F_REGISTRY__) {
				global.__RN_DRIVER_R3F_REGISTRY__ = {};
			}
			global.__RN_DRIVER_R3F_REGISTRY__[id] = bridge;
		} else {
			// Single canvas: use direct global
			global.__RN_DRIVER_R3F__ = bridge;
		}

		return () => {
			cacheRef.current.clear();
			if (id && global.__RN_DRIVER_R3F_REGISTRY__) {
				delete global.__RN_DRIVER_R3F_REGISTRY__[id];
			} else {
				global.__RN_DRIVER_R3F__ = undefined;
			}
		};
	}, [scene, camera, raycaster, size, store, id, rapier]);

	return null;
}
