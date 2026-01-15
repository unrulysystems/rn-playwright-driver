# @0xbigboss/rn-driver-r3f

React Three Fiber (R3F) integration for rn-playwright-driver. Test 3D scenes in your React Native app with a Playwright-style API.

## Requirements

- `@0xbigboss/rn-playwright-driver` >= 0.1.0
- `@react-three/fiber` >= 8.0.0
- `three` >= 0.150.0
- `@playwright/test` >= 1.40.0 (for test fixtures)

## Installation

```bash
bun add @0xbigboss/rn-driver-r3f
```

## Setup

R3F testing requires setup on both the app side and test side.

### App Side (Instrumentation)

Add `TestBridge` inside your Canvas component. This exposes R3F scene state to the test driver.

```tsx
import { Canvas } from "@react-three/fiber";
import { TestBridge } from "@0xbigboss/rn-driver-r3f";

function App() {
  return (
    <Canvas>
      {/* Only include in dev/test builds */}
      {__DEV__ && <TestBridge />}
      <MyScene />
    </Canvas>
  );
}
```

#### Multi-Canvas Support

If you have multiple Canvas components, give each a unique ID:

```tsx
<Canvas>
  <TestBridge id="game-canvas" />
  <GameScene />
</Canvas>

<Canvas>
  <TestBridge id="preview-canvas" />
  <PreviewScene />
</Canvas>
```

#### Object Identification

Objects are identified by `userData.testId` (recommended), `name`, or `uuid`:

```tsx
<mesh userData={{ testId: "my-cube" }}>
  <boxGeometry />
  <meshStandardMaterial />
</mesh>
```

### Test Side (Fixtures)

Import `test` from the r3f package to get the extended device with `device.r3f` namespace:

```typescript
import { test, expect } from "@0xbigboss/rn-driver-r3f/test";

test("tap 3D object", async ({ device }) => {
  // R3F locator API
  const cube = device.r3f.getByTestId("my-cube");
  await cube.tap();

  // Check visibility
  expect(await cube.isOnScreen()).toBe(true);

  // Regular device methods still work
  await device.getByTestId("2d-button").tap();
});
```

## API Reference

### device.r3f Namespace

#### Locators

```typescript
// Get locator by userData.testId (recommended)
device.r3f.getByTestId(testId: string, canvasId?: string): R3FLocator

// Get locator by object name (must be unique)
device.r3f.getByName(name: string, canvasId?: string): R3FLocator

// Get locator by Three.js UUID
device.r3f.getByUuid(uuid: string, canvasId?: string): R3FLocator
```

#### Actions

```typescript
// Tap object (shorthand for getByTestId().tap())
await device.r3f.tap(identifier: string, options?: R3FLookupOptions)

// Hit test at screen coordinates
const hit = await device.r3f.hitTest(x: number, y: number, canvasId?: string)

// Hit test returning all intersected objects
const hits = await device.r3f.hitTestAll(x: number, y: number, canvasId?: string)

// Verify hit test result
await device.r3f.verifyHit(x: number, y: number, expectedTestId: string, canvasId?: string)
```

### R3FLocator Methods

```typescript
const cube = device.r3f.getByTestId("my-cube");

// Tap the object center
await cube.tap()

// Get screen position (throws if off-screen)
const pos = await cube.screenPosition()
// { x, y, depth, isOnScreen, isInFrustum }

// Get screen bounding box
const bounds = await cube.bounds()
// { x, y, width, height, isOnScreen }

// Get full object info
const info = await cube.info()
// { name, uuid, type, visible, worldPosition, worldQuaternion, worldScale, testId }

// Check visibility
const visible = await cube.isOnScreen()

// Check existence
const exists = await cube.exists()
```

### Lookup Options

```typescript
type R3FLookupOptions = {
  method?: "testId" | "name" | "uuid";  // default: "testId"
  canvasId?: string;                     // for multi-canvas
};
```

## Optional: Touch Event Routing

For advanced use cases where you need R3F to receive touch events through the harness:

```tsx
import { Canvas } from "@react-three/fiber";
import { TestBridge, R3FTouchAdapter } from "@0xbigboss/rn-driver-r3f";

function App() {
  return (
    <Canvas>
      {__DEV__ && (
        <>
          <TestBridge />
          <R3FTouchAdapter />
        </>
      )}
      <InteractiveScene />
    </Canvas>
  );
}
```

## Alternative: Standalone Helpers

If you prefer function-based helpers over fixtures:

```typescript
import { test } from "@0xbigboss/rn-playwright-driver/test";
import { tapR3FObject, getR3FObjectPosition } from "@0xbigboss/rn-driver-r3f/helpers";

test("tap object", async ({ device }) => {
  await tapR3FObject(device, "my-cube");
  const pos = await getR3FObjectPosition(device, "my-cube");
});
```

Or wrap the device manually:

```typescript
import { test } from "@0xbigboss/rn-playwright-driver/test";
import { withR3F } from "@0xbigboss/rn-driver-r3f";

test("tap object", async ({ device: baseDevice }) => {
  const device = withR3F(baseDevice);
  await device.r3f.tap("my-cube");
});
```

## Production Safety

Do not include `TestBridge` in production builds:

```tsx
// Only in dev/test
{__DEV__ && <TestBridge />}

// Or use environment variable
{process.env.E2E_MODE && <TestBridge />}
```

## License

MIT
