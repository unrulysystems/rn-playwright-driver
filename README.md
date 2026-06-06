# rn-playwright-driver

Playwright-compatible E2E test driver for React Native using Hermes CDP. It runs in Node.js, connects to the app’s Hermes runtime via Metro’s debug endpoint, and drives your app through a JS harness plus optional native modules.

## What this provides

- **Device API**: `evaluate`, `waitForFunction`, `pointer`, `screenshot`, `openURL`, etc.
- **Locators**: `getByTestId`, `getByText`, `getByRole` (requires view-tree module).
- **Core Primitives**: `getWindowMetrics`, `waitForRaf`, `getFrameCount`, pointer paths, event tracing.
- **JS Harness**: `global.__RN_DRIVER__` installed in the app to bridge driver calls.
- **Native Modules (optional)**:
  - View tree queries
  - Screenshots
  - Lifecycle controls
  - App-level native touch injection
- **Companion Touch Backends (optional)**: XCTest and Android Instrumentation clients for OS-level touch injection.

## Packages

| Package | Purpose |
| --- | --- |
| `@0xbigboss/rn-playwright-driver` | Driver + Playwright fixtures + harness |
| `@0xbigboss/rn-driver-view-tree` | View tree queries (locators, bounds, visibility) |
| `@0xbigboss/rn-driver-screenshot` | Screen/region capture |
| `@0xbigboss/rn-driver-lifecycle` | App lifecycle helpers |
| `@0xbigboss/rn-driver-touch` | App-level native touch injection |
| `@0xbigboss/rn-playwright-driver-xctest-companion` | iOS XCTest touch companion reference implementation |
| `@0xbigboss/rn-playwright-driver-instrumentation-companion` | Android Instrumentation touch companion reference implementation |

## Requirements

- Node.js **>= 18**
- React Native app running **Hermes** with Metro debug endpoints enabled
- Expo Modules API for native modules (iOS + Android)

## Installation

Install driver and native modules in your app:

```bash
bun add @0xbigboss/rn-playwright-driver \
  @0xbigboss/rn-driver-view-tree \
  @0xbigboss/rn-driver-screenshot \
  @0xbigboss/rn-driver-lifecycle \
  @0xbigboss/rn-driver-touch
```

Install Playwright in your test workspace:

```bash
bun add -d @playwright/test
```

## App Setup (Harness)

Import the harness once in your app entry:

```ts
import "@0xbigboss/rn-playwright-driver/harness";
```

Then build/run the app so the native modules are installed:

```bash
expo run:ios
# or
expo run:android
```

## Production-safe Setup (Required)

Do **not** ship the harness in production builds. Use one of these patterns so it only loads for E2E/dev:

### Option A: Dev-only entry (recommended)

Use the `/harness/dev` entry point which only installs when `__DEV__` is true or `globalThis.__E2E__` is set:

```ts
// In your app entry (e.g., App.tsx or index.ts)
import "@0xbigboss/rn-playwright-driver/harness/dev";
```

To enable in production E2E builds, set the flag before the import:

```ts
// Set before import for prod E2E testing
globalThis.__E2E__ = true;
import "@0xbigboss/rn-playwright-driver/harness/dev";
```

### Option B: Conditional import (explicit)

```ts
if (__DEV__ || globalThis.__E2E__ === true) {
  void import("@0xbigboss/rn-playwright-driver/harness");
}
```

### Option C: Separate entry file (cleanest for CI)

```ts
// index.e2e.ts
import "./index";
import "@0xbigboss/rn-playwright-driver/harness";
```

Point your E2E build/profile at `index.e2e.ts` so production builds never include the harness.

## Writing Tests

Use the provided Playwright fixtures:

```ts
import { test, expect } from "@0xbigboss/rn-playwright-driver/test";

test("can evaluate JS", async ({ device }) => {
  const result = await device.evaluate<number>("1 + 2 + 3");
  expect(result).toBe(6);
});

test("can tap by testID", async ({ device }) => {
  await device.getByTestId("increment-button").tap();
});

test("wait for animation frame", async ({ device }) => {
  await device.getByTestId("animate-button").tap();
  await device.waitForRaf(3); // Wait 3 frames for animation
  expect(await device.getByTestId("status").text()).toBe("done");
});

test("swipe with path", async ({ device }) => {
  await device.pointer.dragPath([
    { x: 100, y: 400 },
    { x: 200, y: 300 },
    { x: 300, y: 200 },
  ]);
});

test("get window metrics", async ({ device }) => {
  const metrics = await device.getWindowMetrics();
  console.log("Screen size:", metrics.width, "x", metrics.height);
  console.log("Pixel ratio:", metrics.pixelRatio);
});
```

## Configuration

Environment variables for target selection and timeouts:

| Env var | Description | Default |
| --- | --- | --- |
| `RN_METRO_URL` | Metro bundler URL | `http://localhost:8081` |
| `RN_DEVICE_ID` | Device ID to match | _unset_ |
| `RN_DEVICE_NAME` | Device name substring match | _unset_ |
| `RN_TIMEOUT` | Request timeout (ms) | `30000` |

## Touch Backend Status

The current source default is intentionally conservative:

- `auto` mode tries `native-module` only on iOS and Android.
- `native-module` requires `@0xbigboss/rn-driver-touch` in the tested app and `globalThis.__RN_DRIVER__.capabilities.touchNative === true`.
- `xctest` and `instrumentation` clients are implemented but opt-in through `DeviceOptions.touch.order` or `DeviceOptions.touch.backend`; their companion packages are reference integrations, not automatic launchers.
- `cli` exists as a typed backend stub and currently throws `NOT_SUPPORTED`.
- There is no JS harness touch fallback backend in the current release surface.

Example companion preference:

```ts
import { createDevice } from "@0xbigboss/rn-playwright-driver";

const device = createDevice({
  touch: {
    order: ["xctest", "native-module"],
    xctest: { port: 9999 },
  },
});
```

## Running E2E Tests

1. Start Metro for the app (e.g., `expo start`).
2. Run the app on device/simulator with Hermes debugging enabled.
3. Run Playwright:

```bash
bun run test:e2e
```

## Development (Monorepo)

```bash
bun install
bun run check
```

Useful scripts (root):
- `bun run build` – build all packages
- `bun run lint` / `bun run typecheck` – quality checks
- `bun run check` – typecheck + lint + knip + cpd

## Development Notes

- `expo run:ios --device "Device Name"` performs a full native build and then starts Metro as a long-running file watcher. Run E2E tests in a separate terminal while Metro is running.

## Architecture

High-level flow:

```
Playwright test (Node)
  └─ @0xbigboss/rn-playwright-driver (CDP client)
       └─ Hermes Runtime via Metro /json
            └─ global.__RN_DRIVER__ harness
                 └─ Expo native modules (view-tree, screenshot, lifecycle, touch)
```

See `docs/NATIVE-MODULES-ARCHITECTURE.md` for full details.

## Documentation

- [CI Setup](docs/CI.md) - iOS Simulator, Android Emulator, GitHub Actions
- [Advanced Usage](docs/ADVANCED.md) - CDP targeting, timeouts, capabilities
- [API Stability](docs/API-STABILITY.md) - Stability levels, upgrade notes
- [Native Modules Architecture](docs/NATIVE-MODULES-ARCHITECTURE.md) - Internal design

## License

MIT
