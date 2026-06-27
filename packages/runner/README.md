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
    launch: { mode: 'launch', kind: 'plain' },
  },
  playwright: {
    config: 'playwright.config.ts',
  },
})
```

A plain (non dev-client) Expo app uses `launch: { mode: 'launch', kind: 'plain' }`
on iOS — the companion launches the app itself.

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
