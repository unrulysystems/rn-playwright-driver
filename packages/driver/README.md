# rn-playwright-driver

Playwright-compatible E2E test driver for React Native apps.

`@unrulysystems/rn-playwright-driver` runs in Node.js, attaches to a Hermes
runtime through Metro's Chrome DevTools Protocol endpoint, and exposes a
Playwright-style `device` fixture for app evaluation, locators, screenshots,
lifecycle helpers, and pointer input.

## Install

```bash
bun add @unrulysystems/rn-playwright-driver \
  @unrulysystems/rn-driver-view-tree \
  @unrulysystems/rn-driver-screenshot \
  @unrulysystems/rn-driver-lifecycle
```

Install Playwright in the test workspace:

```bash
bun add -d @playwright/test
```

For companion-backed OS-level touch input, install the platform packages:

```bash
bun add -d @unrulysystems/rn-playwright-driver-instrumentation-companion \
  @unrulysystems/rn-playwright-driver-xctest-companion
```

## App Harness

Import the harness from the app entry used for E2E/dev builds:

```ts
import '@unrulysystems/rn-playwright-driver/harness/dev'
```

Do not include the harness in production app entries. Use a dev-only entry, an
E2E-specific entry file, or another build-time guard so production builds do not
install `global.__RN_DRIVER__`.

## Basic Test

```ts
import { expect, test } from '@unrulysystems/rn-playwright-driver/test'

test('can tap by testID', async ({ device }) => {
  await device.getByTestId('increment-button').tap()
  await expect(device.getByTestId('count')).toHaveText('1')
})
```

## Touch Backends

The default touch selection is companion-first and fail-closed:

- iOS uses the XCTest companion (`RN_TOUCH_BACKEND=xctest`).
- Android uses the instrumentation companion
  (`RN_TOUCH_BACKEND=instrumentation`).
- Lower-fidelity `native-module` and `cli` backends are available only when
  explicitly selected.

See the companion package READMEs for platform launch steps:

- `@unrulysystems/rn-playwright-driver-instrumentation-companion`
- `@unrulysystems/rn-playwright-driver-xctest-companion`

## Example E2E Gates

The repo example app owns complete companion-backed scripts:

```bash
cd examples/basic-app
nub run test:e2e:android
nub run test:e2e:ios
```

## Requirements

- Node.js 18+
- React Native app running Hermes
- Metro debug endpoint reachable at `RN_METRO_URL` or `http://localhost:8081`
- Expo Modules API for native modules

Full documentation lives in the repository README:
https://github.com/unrulysystems/rn-playwright-driver#readme
