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

## Device File I/O

`device.files` reads and writes the running app's sandbox from the host, so a
test can assert the real artifact a feature produces (a CSV/PDF export, a cache,
a persisted snapshot) end to end — not just that a button is visible.

```ts
// Read a file the app wrote and assert its bytes.
const csv = await device.files.pull('observation_1.csv', { root: 'document' })
expect(csv.toString('utf8')).toContain('Interval,Actor,Engaged')

// Push a fixture (host path or Buffer) into the sandbox.
await device.files.push('./fixtures/seed.json', 'seed.json', { root: 'document' })
```

`pull` resolves with a `Buffer`; every failure is a typed `FileIoError` with a
`code` (`NOT_FOUND` | `UNAVAILABLE` | `UNSUPPORTED` | `TRANSPORT_FAILED` |
`TOO_LARGE`) — never a silent empty buffer.

**Roots** (default `document`) mirror `expo-file-system`, so one call points at
the app-written file on both platforms:

| Root       | iOS (`<container>`) | Android (`/data/data/<pkg>`) |
| ---------- | ------------------- | ---------------------------- |
| `document` | `Documents/`        | `files/`                     |
| `cache`    | `Library/Caches/`   | `cache/`                     |
| `data`     | container root      | app-home root                |
| `absolute` | unsupported\*       | verbatim device path         |

**Platform support:**

| Target           | Transport                        | Status                       |
| ---------------- | -------------------------------- | ---------------------------- |
| iOS simulator    | `xcrun simctl get_app_container` | supported                    |
| iOS device       | `xcrun devicectl device copy`    | **provisional** (see below)  |
| Android emulator | `adb … run-as <pkg>`             | supported (debuggable build) |
| Android device   | `adb … run-as <pkg>`             | **pending** hardware verify  |

- \*`absolute` is **not supported on iOS** (simulator or device) and rejects
  `UNSUPPORTED`: `device.files` is app-sandbox-scoped, and on the simulator an
  absolute path would resolve to a raw host path. Use it only on Android.
- On Android, `absolute` is an intentional escape hatch **bounded by the app
  UID**, not confined to `/data/data/<pkg>`. The path runs under `run-as <pkg>`,
  so it can reach anything that UID can — the private data dir **and** the
  app-scoped external dir (`/sdcard/Android/data/<pkg>/…`). Reaching broader
  external storage (`/sdcard/…`) depends on the app itself holding the relevant
  Android storage permission — it is the app UID's reach, not a driver grant — and
  nothing another app or the system owns is reachable (the kernel enforces this;
  unreachable paths fail closed as `TRANSPORT_FAILED`). The E2E round-trips the
  `absolute` mechanism through an app-private path (`/data/data/<pkg>/files/…`);
  an external-storage path uses the identical `run-as` transport, differing only in
  the path string (argv covered by unit tests). `..` is rejected so the touched path stays legible, and a
  path containing shell metacharacters (quotes, backtick, `$`, backslash, or a
  newline) is rejected `UNSUPPORTED` before adb runs — the path is interpolated
  into a device-side `run-as … sh -c` command, so it must stay a plain path. Pass a
  full path you intend; the standard `document`/`cache`/`data` roots are the
  sandbox-relative alternative.
- Android requires a **debuggable** build (`run-as`); iOS requires a
  **development-signed** app — both hold for E2E builds.
- The **iOS-device** transport is unit-verified but **provisional** pending a
  real-hardware walkthrough. The verified E2E paths are the **iOS simulator** and
  the **Android emulator**; **physical Android** shares the emulator's `run-as`
  transport but its hardware walkthrough is still pending.

Targeting (bundle id, udid, package, adb serial) is supplied automatically by
the `rn-driver` runner via `RN_APP_BUNDLE_ID` / `RN_SIM_UDID` /
`RN_IOS_TARGET_KIND` / `RN_APP_PACKAGE` (`ANDROID_SERIAL`); set
`DeviceOptions.target` explicitly for a direct `createDevice()`. When you pin
`target` (udid/serial) **and more than one runtime is connected to the same
Metro**, also pass a CDP selector (`deviceName` or `pageIndex`) — Metro exposes no
UDID, so `createDevice` fails closed (`Ambiguous CDP target`) rather than risk
attaching `evaluate()` to a different app than `device.files` reads. With a single
runtime (the usual runner flow) no selector is needed.

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
