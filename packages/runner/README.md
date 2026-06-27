# @unrulysystems/rn-playwright-driver-runner

A config-backed, cross-platform CLI that owns the **native e2e lifecycle** for
[`@unrulysystems/rn-playwright-driver`](https://www.npmjs.com/package/@unrulysystems/rn-playwright-driver)
tests on iOS and Android.

Instead of copying ~400-line per-app shell recipes, you describe your app's facts
once in `rn-driver.config.ts` and run:

```bash
rn-driver test --platform ios
rn-driver test --platform android
rn-driver test --platform all
```

The runner owns the generic lifecycle — simulator/emulator selection, Metro
ownership, touch-companion startup, secure token passing, cold-launch semantics,
Hermes target wait, and cleanup — and then sets the driver's environment-variable
contract and invokes Playwright. The dependency direction is one-way at the
**contract** level: the runner targets the driver's `RN_*` env-var contract and
drives its companions, while the core driver stays orchestration-free and never
references the runner. (The runner does not import driver code, so it carries no
npm dependency on it — install `@unrulysystems/rn-playwright-driver` alongside
this package; your Playwright specs import the driver directly.)

> See `SPEC.md` (the contract) and `BRIEF.md` (the quality bar) in this package
> for the full design.

## Install

```bash
npm install --save-dev @unrulysystems/rn-playwright-driver-runner
```

This package orchestrates the platform companions; install and configure them per
their own READMEs:

- `@unrulysystems/rn-playwright-driver-xctest-companion` (iOS)
- `@unrulysystems/rn-playwright-driver-instrumentation-companion` (Android)

## Configure

Create `rn-driver.config.ts` in your test workspace:

```ts
import { defineRnDriverConfig } from '@unrulysystems/rn-playwright-driver-runner'

export default defineRnDriverConfig({
  metro: {
    command: 'npx expo start --localhost --port 8081',
    // reuseExisting: true,   // attach to an already-running packager
  },
  ios: {
    bundleId: 'com.company.app',
    workspace: 'ios/App.xcworkspace',
    appScheme: 'App',
    // uitestScheme defaults to `${appScheme}UITests`
    launch: {
      // expo-dev-client REQUIRES attach mode: the host owns the launch and
      // hands the dev launcher the Metro URL via `simctl launch --initialUrl`.
      mode: 'attach',
      kind: 'expo-dev-client',
      // initialUrl defaults to the resolved Metro URL
    },
    // App-specific pre-launch seeds (simctl defaults write):
    // defaults: { EXDevMenuIsOnboardingFinished: true },
  },
  android: {
    packageName: 'com.company.app',
    activity: '.MainActivity',
    // Required only for expo-dev-client launch:
    // scheme: 'companyapp',
    launch: { mode: 'launch', kind: 'plain' },
  },
  playwright: {
    config: 'playwright.config.ts',
  },
})
```

A plain (non dev-client) Expo app uses `launch: { mode: 'launch', kind: 'plain' }`
on both platforms. The companion launches the app itself on iOS; Android launches
the configured `packageName`/`activity` directly.

For Expo dev-client, the host owns native app launch so the app starts on the
test Metro instead of stopping at the launcher UI:

```ts
export default defineRnDriverConfig({
  metro: { command: 'npx expo start --localhost --port 8081' },
  ios: {
    bundleId: 'com.company.app',
    workspace: 'ios/App.xcworkspace',
    appScheme: 'App',
    launch: { mode: 'attach', kind: 'expo-dev-client' },
  },
  android: {
    packageName: 'com.company.app',
    activity: '.MainActivity',
    scheme: 'companyapp',
    launch: { mode: 'launch', kind: 'expo-dev-client' },
  },
})
```

`launch.initialUrl` defaults to the resolved Metro URL on iOS and Android. iOS
uses `simctl launch --initialUrl`; Android uses the configured
`android.scheme` to open
`<scheme>://expo-development-client/?url=<resolved-metro-url>`.

## Run

```bash
# Inspect the exact plan without touching a device (no side effects):
rn-driver test --platform ios --dry-run

# Run the full lifecycle + Playwright:
rn-driver test --platform ios
rn-driver test --platform android

# Reuse an already-built native project (skip prebuild/pods/gradle/install):
rn-driver test --platform ios --skip-build

# Forward specs / Playwright args:
rn-driver test --platform ios e2e/integration/counter.spec.ts
rn-driver test --platform android -- --grep @smoke
```

### Options

| Option           | Description                                            |
| ---------------- | ------------------------------------------------------ |
| `-p, --platform` | `ios` \| `android` \| `all` (required)                 |
| `-c, --config`   | Path to the config (default: searched upward from cwd) |
| `-d, --device`   | Simulator udid / emulator serial override              |
| `--dry-run`      | Print the resolved plan and exit; no side effects      |
| `--skip-build`   | Reuse an already-built native project                  |
| `--verbose`      | Stream per-step progress                               |

On failure before Playwright, the runner names the stage that broke
(`config` / `metro` / `device` / `build` / `companion` / `app-launch` /
`hermes-target`) and exits with a distinct code per stage, so a failure tells you
_where_ it failed.

## How it works

```
rn-driver.config.ts
  └─ load + validate  ──► RnDriverConfig
       └─ resolve       ──► simulator/emulator, ports, 0600 token file, Metro url
            └─ plan      ──► an ordered, pure list of lifecycle Steps  (--dry-run shows this)
                 └─ execute  ──► run steps, gate on readiness probes, run Playwright, clean up
```

Token material always travels by `0600` file path (the driver's
`RN_TOUCH_*_TOKEN_FILE` contract); the value never enters argv, env, logs, or
`--dry-run` output. Cleanup is defensive and idempotent — a crashed prior run
never wedges the next (stale companion ports are freed at startup and teardown).

### Playwright lifecycle boundary

Invoke specs through `rn-driver test`, not a standalone `playwright test`
command. The runner starts or reuses Metro, builds and launches the native app,
starts the companion, waits for Hermes, sets the driver env contract, runs
Playwright, and cleans up the state it owns.

Runner-managed Playwright configs should not define app-level `globalSetup` or
`globalTeardown` that starts/stops Metro, launches the native app, starts/stops a
touch companion, or removes runner companion state. Keep those hooks for
test-local concerns only. Specs should consume the environment that
`rn-driver test` provides.

### Runner env contract

These names are the runner-owned surface between native lifecycle setup and
Playwright/driver execution. Token values are never exposed; only file paths are.

| Variable                                                               | Scope   | Meaning                                            |
| ---------------------------------------------------------------------- | ------- | -------------------------------------------------- |
| `RN_METRO_URL`                                                         | both    | Metro URL the app and driver should use            |
| `RN_DEVICE_NAME`                                                       | both    | Hermes target device-name pin                      |
| `RN_TIMEOUT`                                                           | both    | Driver request timeout                             |
| `RN_TOUCH_BACKEND`                                                     | both    | `xctest` on iOS, `instrumentation` on Android      |
| `RN_TOUCH_XCTEST_PORT`, `RN_TOUCH_XCTEST_TOKEN_FILE`                   | iOS     | XCTest companion port and token-file path          |
| `RN_TOUCH_INSTRUMENTATION_PORT`, `RN_TOUCH_INSTRUMENTATION_TOKEN_FILE` | Android | Instrumentation companion port and token-file path |
| `ANDROID_SERIAL`                                                       | Android | adb device pin for the selected emulator/device    |

The runner also owns internal token/config file paths used to start companions
and configure native test targets. Do not pass token values through argv, inline
env, or docs.

### Prebuild environment and priming

`expo prebuild` runs inside the runner process, so it inherits the runner
process environment. The intended stable marker for test-only Expo config,
plugins, or native settings is `RN_E2E=1`; this package does not emit that marker
yet, so treat it as the planned contract rather than current behavior.

The implemented lifecycle already covers prebuild, Metro, app launch, companion
startup, Hermes waits, Playwright env, and cleanup. Priming controls such as
`RN_E2E_PRIMED=1` or a `prebuild.clean` option are future design space and are
not available runner flags today.

## Requirements

- The `rn-driver` CLI runs under **Node >= 22**. The published `bin` is a thin
  Node shim that loads built JavaScript from `dist`, so npm/Yarn consumers do not
  need bun or nub on `PATH`.
- The readiness probes use the global `WebSocket`/`fetch`, so embedding the
  library API (the `.` export) standalone requires **Node >= 22**.
- The platform companion packages installed and their Expo config plugins added.
- `xcrun`/`xcodebuild`/`pod` (iOS) and `adb`/`gradle` (Android) on `PATH`.

## License

[MIT](../../LICENSE) © Unruly Systems LLC
