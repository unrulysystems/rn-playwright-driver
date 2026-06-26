# rn-playwright-driver

[![npm](https://img.shields.io/npm/v/@unrulysystems/rn-playwright-driver)](https://www.npmjs.com/package/@unrulysystems/rn-playwright-driver)
[![license](https://img.shields.io/npm/l/@unrulysystems/rn-playwright-driver)](LICENSE)

Drive a React Native app from a Playwright test the same way you'd drive a web page. `rn-playwright-driver` runs in Node.js, attaches to the app's **Hermes** runtime over the Chrome DevTools Protocol (through Metro's debug endpoint), and exposes a `device` handle — `evaluate`, locators, pointer/touch, screenshots, and lifecycle — via a JS harness plus optional native modules.

## What this provides

- **Device API**: `evaluate`, `waitForFunction`, `pointer`, `screenshot`, `openURL`, etc.
- **Locators**: `getByTestId`, `getByText`, `getByRole` (requires view-tree module).
- **Text input**: `locator.fill(text)` sets a value and fires a synthetic change so controlled inputs commit to React state (no native keyboard module).
- **Core Primitives**: `getWindowMetrics`, `waitForRaf`, `getFrameCount`, pointer paths, event tracing.
- **JS Harness**: `global.__RN_DRIVER__` installed in the app to bridge driver calls.
- **Native Modules (optional)**:
  - View tree queries
  - Screenshots
  - Lifecycle controls
  - App-level native touch injection
- **Companion Touch Backends (optional)**: XCTest and Android Instrumentation clients for OS-level touch injection.

## Packages

| Package                                                         | Purpose                                               |
| --------------------------------------------------------------- | ----------------------------------------------------- |
| `@unrulysystems/rn-playwright-driver`                           | Driver + Playwright fixtures + harness                |
| `@unrulysystems/rn-driver-view-tree`                            | View tree queries (locators, bounds, visibility)      |
| `@unrulysystems/rn-driver-screenshot`                           | Screen/region capture                                 |
| `@unrulysystems/rn-driver-lifecycle`                            | App lifecycle helpers                                 |
| `@unrulysystems/rn-driver-touch`                                | Explicit lower-fidelity in-app touch injection        |
| `@unrulysystems/rn-playwright-driver-instrumentation-companion` | Android Instrumentation touch companion config plugin |
| `@unrulysystems/rn-playwright-driver-xctest-companion`          | iOS XCTest touch companion scaffold/plugin            |

> Companion backends are the confidence path for pointer input. The native touch
> module remains available for fast in-app loops, but it is scoped to the app
> process/current app windows and is not the default e2e gate.

## Requirements

- Node.js **>= 18**
- React Native app running **Hermes** with Metro debug endpoints enabled
- Expo Modules API for native modules (iOS + Android)

## Installation

Install driver and native modules in your app:

```bash
bun add @unrulysystems/rn-playwright-driver \
  @unrulysystems/rn-driver-view-tree \
  @unrulysystems/rn-driver-screenshot \
  @unrulysystems/rn-driver-lifecycle \
  @unrulysystems/rn-driver-touch
```

For OS-level touch injection, install the platform companion packages and add
their Expo config plugins:

```bash
bun add -d @unrulysystems/rn-playwright-driver-instrumentation-companion \
  @unrulysystems/rn-playwright-driver-xctest-companion
```

```json
{
  "expo": {
    "plugins": [
      "@unrulysystems/rn-playwright-driver-instrumentation-companion",
      "@unrulysystems/rn-playwright-driver-xctest-companion"
    ]
  }
}
```

Install Playwright in your test workspace:

```bash
bun add -d @playwright/test
```

## App Setup (Harness)

Import the harness once in your app entry:

```ts
import '@unrulysystems/rn-playwright-driver/harness'
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
import '@unrulysystems/rn-playwright-driver/harness/dev'
```

To enable in production E2E builds, set the flag before the import:

```ts
// Set before import for prod E2E testing
globalThis.__E2E__ = true
import '@unrulysystems/rn-playwright-driver/harness/dev'
```

### Option B: Conditional import (explicit)

```ts
if (__DEV__ || globalThis.__E2E__ === true) {
  void import('@unrulysystems/rn-playwright-driver/harness')
}
```

### Option C: Separate entry file (cleanest for CI)

```ts
// index.e2e.ts
import './index'
import '@unrulysystems/rn-playwright-driver/harness'
```

Point your E2E build/profile at `index.e2e.ts` so production builds never include the harness.

## Writing Tests

Use the provided Playwright fixtures:

```ts
import { test, expect } from '@unrulysystems/rn-playwright-driver/test'

test('can evaluate JS', async ({ device }) => {
  const result = await device.evaluate<number>('1 + 2 + 3')
  expect(result).toBe(6)
})

test('can tap by testID', async ({ device }) => {
  await device.getByTestId('increment-button').tap()
})

test('wait for animation frame', async ({ device }) => {
  await device.getByTestId('animate-button').tap()
  await device.waitForRaf(3) // Wait 3 frames for animation
  expect(await device.getByTestId('status').text()).toBe('done')
})

test('swipe with path', async ({ device }) => {
  await device.pointer.dragPath([
    { x: 100, y: 400 },
    { x: 200, y: 300 },
    { x: 300, y: 200 },
  ])
})

test('get window metrics', async ({ device }) => {
  const metrics = await device.getWindowMetrics()
  console.log('Screen size:', metrics.width, 'x', metrics.height)
  console.log('Pixel ratio:', metrics.pixelRatio)
})
```

### Scrolling

Reach content below the fold with `locator.scrollIntoView()`, or scroll the
content directly with `device.scroll()`.

```ts
test('assert a below-the-fold chart', async ({ device }) => {
  // Scrolls the content (bounded swipes) until the element is fully on screen.
  const chart = device.getByTestId('revenue-chart')
  await chart.scrollIntoView()
  expect(await chart.isVisible()).toBe(true)
  await chart.screenshot()
})

test('scroll without an element target', async ({ device }) => {
  // Content-delta scroll, anchored at the viewport center. Sign matches the web
  // `scrollBy`: dy > 0 reveals content below, dx > 0 reveals content to the right.
  await device.scroll({ dy: 400 }) // scroll down ~400 logical points
  await device.scroll({ dy: -400 }) // scroll back up
})
```

`scrollIntoView()` infers the direction from the element's measured bounds. For
not-yet-rendered (virtualized) content, pass `direction` to drive a blind scroll
until it appears, and tune `maxScrolls`/`margin` as needed:

```ts
await device.getByText('Load more').scrollIntoView({ direction: 'down', maxScrolls: 20 })
```

> Scroll gestures stay within a mid-screen safe band and use a low-momentum
> motion, so the scrolled offset approximates the requested delta. The magnitude
> of a single `device.scroll()` is therefore bounded by the on-screen swipe
> distance; `scrollIntoView()` loops as many gestures as needed.

### Filling text inputs

Set a text input's value with `locator.fill(text)`. It replaces the current
value in one shot (not a key-by-key `type()`), mirrors it onto the native view,
and fires a synthetic change so **controlled** inputs commit to React state — no
native keyboard module required. It auto-waits for the input to be actionable.

```ts
test('fill a form field', async ({ device }) => {
  await device.getByTestId('name-input').fill('Ada Lovelace')
  // A controlled input's mirrored value reflects the committed React state.
  expect(await device.getByTestId('name-value').text()).toBe('Ada Lovelace')
})
```

> `fill()` resolves its target by **testID only** — pass a plain
> `getByTestId(...)`. `nth()`, scoped, `getByRole()`, and `getByText()` locators
> throw `NOT_SUPPORTED` rather than silently filling the wrong input, so give the
> field a unique testID. A non–text-input element throws `NOT_A_TEXT_INPUT`.

## Configuration

Environment variables for target selection and timeouts:

| Env var          | Description                 | Default                 |
| ---------------- | --------------------------- | ----------------------- |
| `RN_METRO_URL`   | Metro bundler URL           | `http://localhost:8081` |
| `RN_DEVICE_ID`   | Device ID to match          | _unset_                 |
| `RN_DEVICE_NAME` | Device name substring match | _unset_                 |
| `RN_TIMEOUT`     | Request timeout (ms)        | `30000`                 |

Touch backend environment variables used by the Playwright fixture:

| Env var                               | Description                                              | Default     |
| ------------------------------------- | -------------------------------------------------------- | ----------- |
| `RN_TOUCH_BACKEND`                    | Force `native-module`, `cli`, `instrumentation`, etc.    | `auto`      |
| `RN_TOUCH_CLI_ADB_PATH`               | `adb` executable path for the Android CLI backend        | `adb`       |
| `RN_TOUCH_INSTRUMENTATION_PORT`       | Local forwarded companion port                           | `9999`      |
| `RN_TOUCH_INSTRUMENTATION_TOKEN_FILE` | File containing the local instrumentation auth token     | _unset_     |
| `RN_TOUCH_INSTRUMENTATION_TOKEN`      | Inline token fallback when a token file is not practical | _unset_     |
| `RN_TOUCH_XCTEST_HOST`                | XCTest companion host                                    | `127.0.0.1` |
| `RN_TOUCH_XCTEST_PORT`                | XCTest companion port                                    | `9999`      |
| `RN_TOUCH_XCTEST_URL`                 | Full XCTest companion WebSocket URL override             | _unset_     |
| `RN_TOUCH_XCTEST_TOKEN_FILE`          | File containing the local XCTest companion auth token    | _unset_     |
| `RN_TOUCH_XCTEST_TOKEN`               | Inline token fallback when a token file is not practical | _unset_     |

## Touch Backend Status

The current source default is companion-first and fail-closed:

- `auto` mode selects `xctest` on iOS and `instrumentation` on Android.
- If the platform companion is not running, `auto` fails with setup diagnostics instead of silently falling back.
- `instrumentation` is the Android confidence backend and injects input through the instrumentation process / `UiAutomation`.
- `xctest` is the iOS confidence backend and drives input through XCTest.
- `native-module` requires `@unrulysystems/rn-driver-touch` and is an explicit lower-fidelity in-app/current-window backend.
- `cli` is an explicit Android adb backend for diagnostics and is limited to gestures expressible through adb input commands.
- There is no JS harness touch fallback backend in the current release surface.

Example lower-fidelity Android CLI preference:

```ts
import { createDevice } from '@unrulysystems/rn-playwright-driver'

const device = createDevice({
  touch: {
    mode: 'force',
    backend: 'cli',
    cli: { serial: process.env.RN_DEVICE_ID },
  },
})
```

Example Android instrumentation preference:

```ts
import { readFileSync } from 'node:fs'
import { createDevice } from '@unrulysystems/rn-playwright-driver'

const tokenFile = process.env.RN_TOUCH_INSTRUMENTATION_TOKEN_FILE

const device = createDevice({
  touch: {
    mode: 'force',
    backend: 'instrumentation',
    instrumentation: {
      port: 9999,
      authToken: tokenFile
        ? readFileSync(tokenFile, 'utf8').trim()
        : process.env.RN_TOUCH_INSTRUMENTATION_TOKEN,
    },
  },
})
```

## Running E2E Tests

For the example app, use the companion-backed gates. These scripts prebuild the
native app, start Metro, start the platform companion, run Playwright, and clean
up the companion process/ports:

```bash
cd examples/basic-app
bun run test:e2e:android # Android instrumentation companion
bun run test:e2e:ios     # iOS XCTest companion
```

For your app, the same shape applies:

1. Import `@unrulysystems/rn-playwright-driver/harness/dev` in the E2E/dev entry.
2. Add the platform companion config plugin and regenerate native projects.
3. Start Metro and run the app with Hermes debugging enabled.
4. Start the platform companion.
5. Run Playwright with the matching backend:

```bash
RN_TOUCH_BACKEND=instrumentation bun run test:e2e # Android
RN_TOUCH_BACKEND=xctest bun run test:e2e          # iOS
```

See
[`packages/instrumentation-companion/README.md`](packages/instrumentation-companion/README.md)
and
[`packages/xctest-companion/README.md`](packages/xctest-companion/README.md)
for the companion launch commands and token-file setup. Prefer token files
(`RN_TOUCH_INSTRUMENTATION_TOKEN_FILE`, `RN_TOUCH_XCTEST_TOKEN_FILE`) over inline
token environment variables in local scripts.

## Development (Monorepo)

```bash
bun install
bun run check
```

Useful scripts (root):

- `bun run build` – build all packages
- `bun run lint` / `bun run typecheck` – quality checks
- `bun run check` – typecheck + lint + format:check + test

## Development Notes

- `expo run:ios --device "Device Name"` performs a full native build and then starts Metro as a long-running file watcher. Run E2E tests in a separate terminal while Metro is running.

## Architecture

High-level flow:

```
Playwright test (Node)
  └─ @unrulysystems/rn-playwright-driver (CDP client)
       └─ Hermes Runtime via Metro /json
            └─ global.__RN_DRIVER__ harness
                 └─ Expo native modules (view-tree, screenshot, lifecycle, touch)
```

See `docs/NATIVE-MODULES-ARCHITECTURE.md` for full details.

## Documentation

- [RN / Hermes CDP Playbook](docs/RN-HERMES-CDP-PLAYBOOK.md) - the hard-won constraints of driving React Native over CDP
- [CI Setup](docs/CI.md) - iOS Simulator, Android Emulator, GitHub Actions
- [Advanced Usage](docs/ADVANCED.md) - CDP targeting, timeouts, capabilities
- [API Stability](docs/API-STABILITY.md) - Stability levels, upgrade notes
- [Native Modules Architecture](docs/NATIVE-MODULES-ARCHITECTURE.md) - Internal design

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup
and the dev workflow, [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community
expectations, and [SECURITY.md](SECURITY.md) to report a vulnerability privately.

## License

[MIT](LICENSE) © Unruly Systems LLC
