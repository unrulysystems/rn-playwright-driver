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
    // target defaults to "simulator"; use "device" for physical iOS devices.
    // target: 'device',
    // Human-attended physical-device signing opt-in:
    // allowProvisioningUpdates: true,
    // uitestScheme defaults to `${appScheme}UITests`
    launch: {
      // expo-dev-client REQUIRES attach mode: the host owns the launch and
      // hands the dev launcher the Metro URL via simctl/devicectl launch. The
      // runner installs the built app first (XCTest only installs it in
      // launch/activate mode).
      mode: 'attach',
      kind: 'expo-dev-client',
      // initialUrl defaults to the resolved Metro URL on simulators. Physical
      // iOS devices require an explicit LAN/tunnel URL reachable from the phone.
    },
    // App-specific pre-launch seeds, written into the app container's
    // NSUserDefaults after the install (typed: boolean, number, or string).
    // Dev-client apps get the expo-dev-menu onboarding seeds automatically.
    // defaults: { MyFeatureFlag: true },
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
  hooks: {
    configureTarget: (target) => ({
      env: {
        metro: {
          EXPO_PUBLIC_E2E_TARGET: `${target.platform}:${target.kind}`,
        },
        playwright: {
          E2E_TARGET_ID: target.id,
        },
      },
    }),
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

For a dev client the runner also marks the expo-dev-menu onboarding finished
and hides its floating button before the launch (iOS:
`EXDevMenuIsOnboardingFinished`, `EXDevMenuShowsAtLaunch`, and
`EXDevMenuShowFloatingActionButton` in the app container; Android:
`expo.modules.devmenu.sharedpreferences.xml`). Without it the dev menu opens
over the app at launch and its button floats over the app, taking the suite's
taps.

The runner starts Metro with `--dns-result-order=ipv4first` appended to
`NODE_OPTIONS` (your own `NODE_OPTIONS` value is kept). Expo hands the app
`127.0.0.1` URLs, while `expo start --localhost` binds the `localhost` hostname,
which Node resolves to `::1` first on hosts whose resolver lists the IPv6
loopback first; without the option the app reports "Could not connect to
development server" and the Hermes wait times out. `--dry-run` prints the
appended value as `NODE_OPTIONS+=…`.

### Physical iOS devices

Physical iOS support is Expo-dev-client only in this release. Set
`ios.target: 'device'` and provide a device-reachable `ios.launch.initialUrl`
such as a LAN IP or tunnel URL. The runner still probes Metro on the host-side
`metro.url`; `initialUrl` is the URL the iPhone opens.

```ts
export default defineRnDriverConfig({
  metro: {
    command: 'npx expo start --host lan --port 8081',
    url: 'http://127.0.0.1:8081',
  },
  ios: {
    target: 'device',
    allowProvisioningUpdates: true,
    bundleId: 'com.company.app',
    workspace: 'ios/App.xcworkspace',
    appScheme: 'App',
    scheme: 'companyapp',
    launch: {
      mode: 'attach',
      kind: 'expo-dev-client',
      initialUrl: 'http://192.168.1.10:8081',
    },
  },
})
```

Discover attached/paired iPhones with:

```bash
xcrun devicectl list devices
```

If more than one physical iOS device is available, select one explicitly:

```bash
rn-driver test --platform ios --device 00008130-0012493614E8001C
rn-driver test --platform ios --device "Roman Crystal"
```

The physical-device plan uses `xcrun devicectl device process launch
--terminate-existing --payload-url <dev-client-url> <bundleId>` for app launch
and emits `RN_IOS_TARGET_KIND=device` for driver file I/O. Simulator behavior
remains the default and continues to use `simctl`.

### Target-aware project network setup

The runner owns React Native control-plane connectivity: target selection,
Metro readiness, app launch, Hermes discovery, companion ports, driver env, and
cleanup for resources it created. App service topology stays project-owned:
Supabase, RPC/bundler/paymaster URLs, seed APIs, Mailpit, localnet ports,
feature flags, LAN profiles, and tunnels.

Use `hooks.configureTarget` to add target-aware project configuration without
hiding side effects outside the runner plan. The hook receives the selected
target and returns scoped env, project-owned command steps, and cleanup:

```ts
export default defineRnDriverConfig({
  // ...
  hooks: {
    configureTarget: (target) => ({
      env: {
        // Applied to the Metro process started by the runner. If you reuse an
        // already-running Metro, start that Metro with equivalent env yourself.
        metro: {
          EXPO_PUBLIC_SUPABASE_URL: supabaseUrlFor(target),
          EXPO_PUBLIC_BASE_RPC_URL: rpcUrlFor(target),
        },
        // Applied to the Playwright process. Runner-owned RN_* driver env wins
        // if a project key conflicts with the driver contract.
        playwright: {
          E2E_NETWORK_PROFILE: `${target.platform}-${target.kind}`,
        },
      },
      steps: {
        beforeLaunch:
          target.platform === 'android' && target.kind === 'emulator'
            ? [
                {
                  id: 'app.reverse-supabase',
                  description: 'Reverse app-owned Supabase port',
                  stage: 'device',
                  command: {
                    command: 'adb',
                    args: ['-s', target.id, 'reverse', 'tcp:54321', 'tcp:54321'],
                  },
                },
              ]
            : [],
      },
      cleanup:
        target.platform === 'android' && target.kind === 'emulator'
          ? [
              {
                description: 'Remove app-owned Supabase reverse',
                command: {
                  command: 'adb',
                  args: ['-s', target.id, 'reverse', '--remove', 'tcp:54321'],
                },
              },
            ]
          : [],
    }),
  },
})
```

Project steps are inserted at stable points: `beforeMetro`, `afterMetroReady`,
and `beforeLaunch`. They are rendered by `--dry-run`, executed by the same
runner executor as built-in steps, and cleaned up through the runner's `finally`
path. Do not pass secret values through hook env or argv; pass file paths and
stdin references instead.

For iOS physical devices, `target.kind` is `device` and `target.metroUrl` is the
device-reachable `launch.initialUrl`. Keep app backend topology project-owned:
use hooks to choose LAN/tunnel URLs or project-owned setup commands, not runner
defaults.

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

| Option           | Description                                             |
| ---------------- | ------------------------------------------------------- |
| `-p, --platform` | `ios` \| `android` \| `all` (required)                  |
| `-c, --config`   | Path to the config (default: searched upward from cwd)  |
| `-d, --device`   | Simulator/device id or name / Android serial override   |
| `--dry-run`      | Print the plan and exit; no side effects, no device I/O |
| `--skip-build`   | Reuse an already-built native project                   |
| `--verbose`      | Stream per-step progress                                |

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

`--dry-run` enters at the **plan** step and skips **resolve** entirely, because
REQ-CLI-002 requires it to exit 0 with no device touch — that is what lets it run
offline, on a machine with no Xcode or Android SDK. The consequence is that it does
not check `--device`: device ids print as `<sim-udid>`/`<android-serial>` placeholders
whatever you pass, and a name that matches no device still exits 0. It prints a note
saying so when `--device` is given. Only a real run resolves the device, and it fails
at stage `device` (exit 12) when nothing matches.

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

`expo prebuild` runs inside the runner process and inherits the runner process
environment. The runner sets `RN_E2E=1` on every prebuild it plans and every
Metro it starts (both show in `--dry-run`). That marker is the stable contract for
test-only Expo config: the driver's Metro helper serves the harness only under
it, the companion plugins scaffold only under it, and the driver's own plugin
excludes its native modules without it, so an app lists every plugin
unconditionally and never reads the marker in its own source. A Metro the runner reuses
(`metro.reuseExisting`) is the operator's to start with the marker; the driver
reports a missing harness by name when it is not.

The implemented lifecycle already covers prebuild, Metro, app launch, companion
startup, Hermes waits, Playwright env, and cleanup. Priming controls such as
`RN_E2E_PRIMED=1` or a `prebuild.clean` option are future design space and are
not available runner flags today.

## Requirements

- The `rn-driver` CLI runs under **Node >= 22**. The published `bin` is a thin
  Node shim that loads built JavaScript from `dist`, so npm/Yarn consumers do not
  need bun or nub on `PATH`.
- The readiness probes use the global `WebSocket`/`fetch`, so embedding the
  library API (the `.` export) standalone requires **Node >= 22**. `rn-driver
test` checks for those globals before its first effectful step and fails at
  stage `config` on an older Node (a Node 20 consumer can run the bin under
  `bun` instead); `--dry-run` works on any runtime.
- The platform companion packages installed and their Expo config plugins added.
- `xcrun`/`xcodebuild`/`pod` (iOS) and `adb`/`gradle` (Android) on `PATH`.

## License

[MIT](../../LICENSE) © Unruly Systems LLC
