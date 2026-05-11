# R3F Integration Specification

> **Status**: Draft
> **Package**: `@0xbigboss/rn-driver-r3f`

## Overview

Three.js/React Three Fiber (R3F) content renders to a GL canvas, bypassing the native view hierarchy. This spec defines how R3F apps integrate with `rn-playwright-driver` for E2E testing.

> **Note**: JS touch handler routing (`registerTouchHandler`) and the R3FTouchAdapter have been removed. Use `TestBridge.dispatchPointer()` for direct R3F event tests, and keep native touch backend tests separate.

## Problem Statement

| Feature | Native Views | GL Canvas (R3F) |
|---------|--------------|-----------------|
| `getByTestId()` | ✅ Works | ❌ Not in view tree |
| `getByText()` | ✅ Works | ❌ Text is rendered pixels |
| `pointer.tap(x, y)` | ✅ Works | ✅ Works (coordinate-based) |
| `screenshot()` | ✅ Works | ✅ Works |

**Core constraint**: Three.js objects exist in a separate scene graph, not the React Native view tree. Native modules (`view-tree`, `screenshot`) see only the GL canvas element, not individual 3D objects.

## Design Goals

1. **Coordinate-based testing by default** - Tap/drag by screen coordinates works universally
2. **Optional scene bridge** - Apps can expose R3F internals for richer queries
3. **Framework-agnostic driver** - No R3F code in the driver package
4. **Native touch injection only** - No JS touch handler routing
5. **CDP-serializable only** - All bridge methods return JSON-serializable values

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Test Process                             │
│                                                                  │
│   test('tap 3D object', async ({ device }) => {                 │
│     // Query scene via bridge                                    │
│     const pos = await device.evaluate(                          │
│       `global.__RN_DRIVER_R3F__.getObjectScreenPosition('cube')`│
│     );                                                           │
│     await device.pointer.tap(pos.x, pos.y);                     │
│   });                                                            │
└────────────────────────────────────────────────────────────────┘
                              │
                              │ CDP (evaluate)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         App Process                              │
│                                                                  │
│   global.__RN_DRIVER__      global.__RN_DRIVER_R3F__            │
│   ├── pointer               ├── getObjectScreenPosition()       │
│   ├── viewTree              ├── getObjectBounds()               │
│   └── screenshot            ├── getObjectInfo()                 │
│                             └── hitTest()                        │
│                                      │                           │
│                                      ▼                           │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  R3F Scene                                               │   │
│   │  ├── camera                                              │   │
│   │  ├── scene.children[]                                    │   │
│   │  └── raycaster                                           │   │
│   └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Shared Types

All types returned by bridge methods must be CDP-serializable (JSON).

```typescript
/**
 * Serializable object descriptor (NOT the Three.js object itself).
 * Used instead of returning Object3D which cannot cross CDP boundary.
 */
type R3FObjectInfo = {
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
type R3FScreenPosition = {
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
type R3FScreenBounds = {
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
type R3FHitResult = {
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
type R3FBridgeCapabilities = {
  /** Core bridge is available */
  core: true;
  /** Rapier physics queries available */
  rapier: boolean;
};
```

---

## Integration Patterns

### Pattern 1: TestBridge Component (Recommended)

A component that exposes R3F scene state to the test harness.

```typescript
// @0xbigboss/rn-driver-r3f/src/TestBridge.tsx
import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Vector3, Box3, Quaternion } from 'three';
import type {
  R3FObjectInfo,
  R3FScreenPosition,
  R3FScreenBounds,
  R3FHitResult,
  R3FBridgeCapabilities,
  R3FDriverBridge,
} from './types';

/**
 * Bridge global type - always includes capability detection.
 */
type R3FDriverBridge = {
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

declare global {
  var __RN_DRIVER_R3F__: R3FDriverBridge | undefined;
}

type TestBridgeProps = {
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

export function TestBridge({ id, rapier = false }: TestBridgeProps) {
  const { scene, camera, raycaster, size } = useThree();
  const cacheRef = useRef<Map<string, THREE.Object3D>>(new Map());

  useEffect(() => {
    // Use R3F state.size for accurate canvas dimensions (logical points)
    const { width, height } = size;

    /**
     * Ensure matrices are up-to-date before any projection.
     * Critical for frameloop="demand" or after external camera changes.
     */
    const updateMatrices = () => {
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld();
      if ('updateProjectionMatrix' in camera) {
        (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
      }
    };

    /**
     * Find object by UUID only (guaranteed unique).
     */
    const findObjectByUuid = (uuid: string): THREE.Object3D | null => {
      const cached = cacheRef.current.get(`uuid:${uuid}`);
      if (cached && cached.parent) return cached;

      const obj = scene.getObjectByProperty('uuid', uuid);
      if (obj) {
        cacheRef.current.set(`uuid:${uuid}`, obj);
      }
      return obj ?? null;
    };

    /**
     * Find object by testId (userData.testId). Returns null if 0 or 2+ matches.
     */
    const findObjectByTestId = (testId: string): THREE.Object3D | null => {
      const matches: THREE.Object3D[] = [];
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
    const findObjectByName = (name: string): THREE.Object3D | null => {
      const matches: THREE.Object3D[] = [];
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
      const projected = worldPos.clone().project(camera);

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
    const computeBounds = (obj: THREE.Object3D): R3FScreenBounds | null => {
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
    const toObjectInfo = (obj: THREE.Object3D): R3FObjectInfo => {
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
    const screenToNdc = (x: number, y: number): { x: number; y: number } => ({
      x: (x / width) * 2 - 1,
      y: -(y / height) * 2 + 1,
    });

    const bridge: R3FDriverBridge = {
      capabilities: {
        core: true,
        rapier,
      },

      getObjectInfo: (name) => {
        // Check for uniqueness
        const matches: THREE.Object3D[] = [];
        scene.traverse((obj) => {
          if (obj.name === name) matches.push(obj);
        });
        if (matches.length !== 1) return null; // Not found or ambiguous
        return toObjectInfo(matches[0]);
      },

      getObjectInfoByUuid: (uuid) => {
        const obj = scene.getObjectByProperty('uuid', uuid);
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
        raycaster.setFromCamera(ndc, camera);
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
        raycaster.setFromCamera(ndc, camera);
        const hits = raycaster.intersectObjects(scene.children, true);

        return hits.map((hit) => ({
          name: hit.object.name,
          uuid: hit.object.uuid,
          point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
          distance: hit.distance,
          testId: (hit.object.userData?.testId as string) ?? null,
        }));
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
            const body = obj.userData?.__rapierRigidBody;
            if (body && typeof body.translation === 'function') {
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
            const body = obj.userData?.__rapierRigidBody;
            if (body && typeof body.isSleeping === 'function') {
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
  }, [scene, camera, raycaster, size, id, rapier]);

  return null;
}

// Multi-canvas registry type
declare global {
  var __RN_DRIVER_R3F_REGISTRY__: Record<string, R3FDriverBridge> | undefined;
}
```

**Usage in app:**

```tsx
import { Canvas } from '@react-three/fiber';
import { TestBridge } from '@0xbigboss/rn-driver-r3f';

function App() {
  return (
    <Canvas>
      {__DEV__ && <TestBridge />}
      <MyScene />
    </Canvas>
  );
}

// Multi-canvas example
function MultiCanvasApp() {
  return (
    <>
      <Canvas id="main">
        {__DEV__ && <TestBridge id="main" />}
        <MainScene />
      </Canvas>
      <Canvas id="minimap">
        {__DEV__ && <TestBridge id="minimap" />}
        <MinimapScene />
      </Canvas>
    </>
  );
}
```

**Usage in tests:**

```typescript
import { test, expect } from '@0xbigboss/rn-playwright-driver/test';

test('tap 3D cube by unique name', async ({ device }) => {
  // Get screen position with visibility check (name must be unique)
  const pos = await device.evaluate<R3FScreenPosition | null>(
    `global.__RN_DRIVER_R3F__?.getObjectScreenPosition('interactive-cube')`
  );

  expect(pos).not.toBeNull();
  expect(pos!.isOnScreen).toBe(true);
  expect(pos!.isInFrustum).toBe(true);

  await device.pointer.tap(pos!.x, pos!.y);
});

test('tap using testId (recommended for reliability)', async ({ device }) => {
  // testId avoids name collision issues
  const pos = await device.evaluate<R3FScreenPosition | null>(
    `global.__RN_DRIVER_R3F__.getObjectScreenPositionByTestId('my-button-id')`
  );
  expect(pos?.isOnScreen).toBe(true);

  await device.pointer.tap(pos!.x, pos!.y);
});

test('tap with occlusion check', async ({ device }) => {
  const pos = await device.evaluate<R3FScreenPosition | null>(
    `global.__RN_DRIVER_R3F__.getObjectScreenPositionByTestId('my-button-id')`
  );
  expect(pos?.isOnScreen).toBe(true);

  // Verify it's the topmost object at that position
  const hit = await device.evaluate<R3FHitResult | null>(
    `global.__RN_DRIVER_R3F__.hitTest(${pos!.x}, ${pos!.y})`
  );
  expect(hit?.testId).toBe('my-button-id');

  await device.pointer.tap(pos!.x, pos!.y);
});

test('find object info by testId', async ({ device }) => {
  const info = await device.evaluate<R3FObjectInfo | null>(
    `global.__RN_DRIVER_R3F__.getObjectInfoByTestId('unique-block-id')`
  );
  expect(info).not.toBeNull();
  expect(info!.visible).toBe(true);
});

// Multi-canvas test
test('interact with specific canvas', async ({ device }) => {
  const pos = await device.evaluate<R3FScreenPosition | null>(
    `global.__RN_DRIVER_R3F_REGISTRY__['minimap']?.getObjectScreenPosition('player-marker')`
  );
  // ...
});
```

---

### Pattern 2: Direct R3F Pointer Dispatch

For deeper R3F event integration, use `TestBridge.dispatchPointer(type, x, y)` from `@0xbigboss/rn-driver-r3f`. This replaced the removed harness `registerTouchHandler` / `R3FTouchAdapter` path.

```typescript
await device.evaluate(
  `globalThis.__RN_DRIVER_R3F__?.dispatchPointer?.("down", 120, 240)`
);
await device.evaluate(
  `globalThis.__RN_DRIVER_R3F__?.dispatchPointer?.("move", 140, 220)`
);
await device.evaluate(
  `globalThis.__RN_DRIVER_R3F__?.dispatchPointer?.("up", 140, 220)`
);
```

**When to use**:
- Testing R3F pointer events (`onPointerDown`, `onPointerMove`, etc.)
- Verifying raycast hit detection
- Testing drag-and-drop within 3D scene

**Limitations**:
- Requires R3F event system setup in the scene
- More complex than coordinate-based testing
- May interfere with native gesture handlers
- Bypasses platform-native touch delivery by design; keep native touch backend tests separate from R3F event-dispatch tests

---

### Pattern 3: Hybrid Testing (Recommended for Production)

Combine native locators for UI and coordinate-based testing for 3D content.

```typescript
test('complete game flow', async ({ device }) => {
  // Native UI: Use locators
  await device.getByTestId('start-button').tap();

  // Wait for scene to load
  await device.waitForFunction(`global.__RN_DRIVER_R3F__ !== undefined`);

  // 3D scene: Use coordinates via bridge
  const block = await device.evaluate<R3FScreenPosition>(
    `global.__RN_DRIVER_R3F__.getObjectScreenPosition('draggable-block')`
  );
  const bin = await device.evaluate<R3FScreenPosition>(
    `global.__RN_DRIVER_R3F__.getObjectScreenPosition('target-bin')`
  );

  // Verify both are on screen
  expect(block.isOnScreen && bin.isOnScreen).toBe(true);

  await device.pointer.drag(
    { x: block.x, y: block.y },
    { x: bin.x, y: bin.y },
    { duration: 300 }
  );

  // Native UI: Verify score
  await expect(device.getByTestId('score')).toHaveText('10');
});
```

---

## API Reference

### `global.__RN_DRIVER_R3F__`

Optional bridge exposed by R3F apps. Not provided by the driver.

| Method | Returns | Description |
|--------|---------|-------------|
| `capabilities` | `R3FBridgeCapabilities` | Feature detection flags |
| `getObjectInfo(name)` | `R3FObjectInfo \| null` | Object info by name (null if 0/2+ matches) |
| `getObjectInfoByUuid(uuid)` | `R3FObjectInfo \| null` | Object info by UUID (always unique) |
| `getObjectInfoByTestId(testId)` | `R3FObjectInfo \| null` | Object info by testId (null if 0/2+ matches) |
| `getAllObjectsByName(name)` | `R3FObjectInfo[]` | All objects with given name |
| `getNamedObjects()` | `{name, uuid, testId}[]` | List all named objects |
| `getObjectScreenPosition(name)` | `R3FScreenPosition \| null` | Screen coords by name (null if 0/2+ matches) |
| `getObjectScreenPositionByUuid(uuid)` | `R3FScreenPosition \| null` | Screen coords by UUID |
| `getObjectScreenPositionByTestId(testId)` | `R3FScreenPosition \| null` | Screen coords by testId (null if 0/2+ matches) |
| `getObjectBounds(name)` | `R3FScreenBounds \| null` | Bounds by name (null if 0/2+ matches) |
| `getObjectBoundsByUuid(uuid)` | `R3FScreenBounds \| null` | Bounds by UUID |
| `getObjectBoundsByTestId(testId)` | `R3FScreenBounds \| null` | Bounds by testId (null if 0/2+ matches) |
| `hitTest(x, y)` | `R3FHitResult \| null` | Topmost hit at screen coords |
| `hitTestAll(x, y)` | `R3FHitResult[]` | All hits at screen coords |

**Rapier methods** (when `capabilities.rapier === true`):

| Method | Returns | Description |
|--------|---------|-------------|
| `getPhysicsBodyPosition(name)` | `{x,y,z} \| null` | World position from RigidBody |
| `getPhysicsBodyScreenPosition(name)` | `R3FScreenPosition \| null` | Screen coords of physics body |
| `isPhysicsBodySleeping(name)` | `boolean \| null` | Whether body is sleeping |

### Multi-Canvas Registry

When using `<TestBridge id="..." />`, the bridge is registered at:
```typescript
global.__RN_DRIVER_R3F_REGISTRY__[id]
```

### Screen Coordinates

All coordinates are in **logical points** (not pixels), matching:
- React Native's coordinate system
- `device.pointer.tap()` expectations
- `device.screenshot()` dimensions
- R3F's `state.size` (width/height)

**Platform notes:**
- **Web**: `state.size` is in CSS pixels (logical points). No adjustment needed.
- **Native (expo-gl)**: `state.size` is in logical points (not physical pixels). The GL context handles device pixel ratio internally via `gl.drawingBufferWidth/Height`. If you observe coordinate drift, verify your expo-gl version handles this correctly, or manually adjust:
  ```typescript
  import { PixelRatio } from 'react-native';
  const scale = PixelRatio.get();
  // If state.size is in physical pixels (older expo-gl):
  const logicalWidth = size.width / scale;
  const logicalHeight = size.height / scale;
  ```
- **Verification**: Log `state.size` and compare to `useWindowDimensions()`. On a 2x display, if `state.size` is 2x larger, it's in physical pixels and needs scaling.

---

## Test Helpers

Optional helper functions for cleaner test code:

```typescript
// @0xbigboss/rn-driver-r3f/helpers.ts
import type { RNDevice } from '@0xbigboss/rn-playwright-driver';
import type { R3FScreenPosition, R3FHitResult } from './types';

type LookupMethod = 'name' | 'uuid' | 'testId';

/**
 * Get screen position for an R3F object.
 * @param method - How to look up the object: 'name', 'uuid', or 'testId'
 */
export async function getR3FObjectPosition(
  device: RNDevice,
  identifier: string,
  options?: { method?: LookupMethod; canvasId?: string }
): Promise<R3FScreenPosition> {
  const { method = 'testId', canvasId } = options ?? {};
  const bridge = canvasId
    ? `global.__RN_DRIVER_R3F_REGISTRY__['${canvasId}']`
    : 'global.__RN_DRIVER_R3F__';

  const methodName = method === 'uuid' ? 'getObjectScreenPositionByUuid'
                   : method === 'testId' ? 'getObjectScreenPositionByTestId'
                   : 'getObjectScreenPosition';

  const pos = await device.evaluate<R3FScreenPosition | null>(
    `${bridge}?.${methodName}(${JSON.stringify(identifier)})`
  );

  if (!pos) {
    throw new Error(`R3F object not found (${method}): ${identifier}`);
  }
  if (!pos.isOnScreen) {
    throw new Error(`R3F object is off-screen: ${identifier}`);
  }
  if (!pos.isInFrustum) {
    throw new Error(`R3F object is outside camera frustum: ${identifier}`);
  }

  return pos;
}

/**
 * Tap an R3F object by testId (default) or other identifier.
 */
export async function tapR3FObject(
  device: RNDevice,
  identifier: string,
  options?: { method?: LookupMethod; canvasId?: string }
): Promise<void> {
  const pos = await getR3FObjectPosition(device, identifier, options);
  await device.pointer.tap(pos.x, pos.y);
}

/**
 * Verify that hitting a screen position returns the expected object.
 */
export async function verifyHitTarget(
  device: RNDevice,
  x: number,
  y: number,
  expectedTestId: string,
  canvasId?: string
): Promise<R3FHitResult> {
  const bridge = canvasId
    ? `global.__RN_DRIVER_R3F_REGISTRY__['${canvasId}']`
    : 'global.__RN_DRIVER_R3F__';

  const hit = await device.evaluate<R3FHitResult | null>(
    `${bridge}?.hitTest(${x}, ${y})`
  );

  if (!hit) {
    throw new Error(`No hit at (${x}, ${y})`);
  }
  if (hit.testId !== expectedTestId) {
    throw new Error(
      `Expected to hit testId='${expectedTestId}' but hit '${hit.name}' (testId: ${hit.testId})`
    );
  }

  return hit;
}
```

**Usage:**

```typescript
import { tapR3FObject, getR3FObjectPosition } from '@0xbigboss/rn-driver-r3f/helpers';

test('tap by testId (default, recommended)', async ({ device }) => {
  await tapR3FObject(device, 'my-block-id');
});

test('tap by UUID', async ({ device }) => {
  const uuid = await device.evaluate<string>(
    `global.__RN_DRIVER_R3F__.getObjectInfoByTestId('my-block-id')?.uuid`
  );
  await tapR3FObject(device, uuid, { method: 'uuid' });
});

test('tap by name (only if unique)', async ({ device }) => {
  await tapR3FObject(device, 'unique-mesh-name', { method: 'name' });
});
```

---

## Edge Cases

### Camera Movement

If the camera moves between queries and actions, objects may have moved on screen.

**Mitigation**: Query position immediately before action:

```typescript
// BAD: Position may be stale
const pos = await getR3FObjectPosition(device, 'cube');
await device.pointer.tap(100, 100); // Some other action
await device.pointer.tap(pos.x, pos.y); // Cube may have moved

// GOOD: Query immediately before tap
await device.pointer.tap(100, 100);
const pos = await getR3FObjectPosition(device, 'cube');
await device.pointer.tap(pos.x, pos.y);
```

### Off-screen / Behind Camera Objects

The `R3FScreenPosition` type includes visibility information:

```typescript
const pos = await device.evaluate<R3FScreenPosition | null>(
  `global.__RN_DRIVER_R3F__.getObjectScreenPositionByTestId('cube-id')`
);

if (!pos) {
  throw new Error('Object not found');
}
if (!pos.isInFrustum) {
  throw new Error('Object is outside camera frustum');
}
if (!pos.isOnScreen) {
  throw new Error('Object is outside viewport');
}

// Safe to tap
await device.pointer.tap(pos.x, pos.y);
```

### Name Collisions

When multiple objects share the same name:

```typescript
// getObjectInfo returns null for ambiguous names
const info = await device.evaluate<R3FObjectInfo | null>(
  `global.__RN_DRIVER_R3F__.getObjectInfo('common-name')`
);
// info === null if 0 or 2+ matches

// Use UUID for guaranteed uniqueness
const info = await device.evaluate<R3FObjectInfo | null>(
  `global.__RN_DRIVER_R3F__.getObjectInfoByUuid('abc123-def456-...')`
);

// Or use userData.testId
const info = await device.evaluate<R3FObjectInfo | null>(
  `global.__RN_DRIVER_R3F__.getObjectInfoByTestId('my-unique-test-id')`
);

// Or get all matches and pick the right one
const all = await device.evaluate<R3FObjectInfo[]>(
  `global.__RN_DRIVER_R3F__.getAllObjectsByName('common-name')`
);
const target = all.find(o => o.worldPosition.x > 0);
```

### Z-fighting / Occlusion

Use `hitTest` to verify which object would actually receive a tap:

```typescript
const pos = await device.evaluate<R3FScreenPosition | null>(
  `global.__RN_DRIVER_R3F__.getObjectScreenPositionByTestId('my-button-id')`
);
expect(pos?.isOnScreen).toBe(true);

// Verify my-button is actually the topmost object at that position
const hit = await device.evaluate<R3FHitResult | null>(
  `global.__RN_DRIVER_R3F__.hitTest(${pos!.x}, ${pos!.y})`
);

if (hit?.testId !== 'my-button-id') {
  throw new Error(`Expected my-button-id but hit ${hit?.name ?? 'nothing'} (testId: ${hit?.testId})`);
}
```

### Multiple Canvases

When multiple `<Canvas>` components exist, each needs a unique `id`:

```tsx
<Canvas>
  <TestBridge id="main" />
  <MainScene />
</Canvas>

<Canvas>
  <TestBridge id="overlay" />
  <OverlayScene />
</Canvas>
```

Access via registry:
```typescript
const mainPos = await device.evaluate(
  `global.__RN_DRIVER_R3F_REGISTRY__['main']?.getObjectScreenPosition('cube')`
);

const overlayPos = await device.evaluate(
  `global.__RN_DRIVER_R3F_REGISTRY__['overlay']?.getObjectScreenPosition('icon')`
);
```

---

## Design Decisions

### 1. Package Structure

**Decision**: Ship as `@0xbigboss/rn-driver-r3f`

**Rationale**:
- Clean separation from core driver
- Independent versioning for R3F compatibility
- Optional dependency - only install if using R3F
- Can track R3F major versions independently

**Package structure**:
```
packages/
└── r3f/                           # @0xbigboss/rn-driver-r3f
    ├── src/
    │   ├── TestBridge.tsx         # Scene bridge component
    │   ├── types.ts               # Shared type definitions
    │   ├── helpers.ts             # Test helper functions
    │   ├── locator.ts             # R3F locator namespace
    │   ├── test.ts                # Playwright fixture wrapper
    │   └── index.ts
    ├── package.json
    └── README.md
```

### 2. CDP-Serializable Returns Only

**Decision**: All bridge methods return JSON-serializable types, never Three.js objects.

**Rationale**:
- `device.evaluate()` serializes return values across CDP
- Returning `THREE.Object3D` would cause runtime errors
- Serializable descriptors (`R3FObjectInfo`) provide needed data
- UUID/testId allow subsequent lookups if needed

**Removed**: `findObjectByName` returning `Object3D` - replaced with `getObjectInfo` returning `R3FObjectInfo`.

### 3. Touch Handler Contract Alignment

**Decision**: Keep existing harness `TouchHandler` contract unchanged. R3F adapter converts internally.

**Rationale**:
- No breaking change to existing harness
- NDC conversion is R3F-specific detail
- Each framework adapter handles its own coordinate system
- Harness provides logical points; adapter converts as needed

**Harness contract** (unchanged):
```typescript
type TouchEvent = { x: number; y: number; type: "down" | "move" | "up"; timestamp: number };
type TouchHandler = (event: TouchEvent) => void;
```

### 4. Rapier Integration via Capability Flag

**Decision**: Use `capabilities.rapier` flag instead of conditional global type.

**Rationale**:
- Global type can't change based on component props
- Capability flag enables runtime feature detection
- Rapier methods are optional on the interface (`getPhysicsBodyPosition?: ...`)
- Tests can check `capabilities.rapier` before calling physics methods

**Bridge type**:
```typescript
type R3FDriverBridge = {
  capabilities: { core: true; rapier: boolean };
  // ... core methods
  getPhysicsBodyPosition?: (...) => ...;  // Optional
};
```

### 5. Multi-Canvas Support via Registry

**Decision**: Single canvas uses `global.__RN_DRIVER_R3F__`; multiple canvases use ID-keyed registry.

**Rationale**:
- Simple case (single canvas) has simple API
- Multi-canvas is opt-in via `id` prop
- Registry pattern avoids global collisions
- Each canvas bridge is isolated

### 6. Matrix Update Before Projection

**Decision**: Always call `updateMatrixWorld(true)` and camera matrix updates before projections.

**Rationale**:
- R3F with `frameloop="demand"` may have stale matrices
- External camera controls may not trigger matrix updates
- Cost is minimal; correctness is critical
- Prevents subtle bugs from stale transforms

### 7. Uniqueness Enforcement for Lookups

**Decision**: All lookup methods return `null` if 0 or 2+ matches (except UUID which is always unique).

**Rationale**:
- Prevents flaky tests from non-deterministic first-match behavior
- Forces explicit handling of ambiguous cases
- `getObjectInfoByTestId` now also enforces uniqueness (testId should be unique)
- Use `getAllObjectsByName` when intentionally querying duplicates

**API structure**:
```typescript
// Enforce uniqueness (return null if ambiguous):
getObjectInfo(name)                    // By Three.js name
getObjectInfoByTestId(testId)          // By userData.testId
getObjectScreenPosition(name)          // By name
getObjectScreenPositionByTestId(id)    // By testId (recommended)

// Always unique (UUID is globally unique):
getObjectInfoByUuid(uuid)
getObjectScreenPositionByUuid(uuid)

// Return all matches:
getAllObjectsByName(name)
```

---

## Open Questions

_None remaining._

---

## References

- [R3F Events Documentation](https://docs.pmnd.rs/react-three-fiber/api/events)
- [Three.js Raycaster](https://threejs.org/docs/#api/en/core/Raycaster)
- [rn-playwright-driver Architecture](./NATIVE-MODULES-ARCHITECTURE.md)
- [Harness Types](../packages/driver/harness/index.ts)
