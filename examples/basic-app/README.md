# Example App (RN Playwright Driver)

Minimal Expo app used to validate the RN Playwright Driver end-to-end. It ships a tiny counter UI plus Playwright tests that exercise the driver API, optional native modules, and view-tree locators.

## What’s inside

- Expo app entry: `index.ts` (installs the driver harness)
- UI under test: `App.tsx` (counter with testIDs)
- E2E tests: `e2e/counter.spec.ts`
- Playwright config: `playwright.config.ts`

## Prerequisites

- Node.js 18+
- nub
- Expo tooling installed
- A simulator/device with Hermes debugging enabled

## Install

From repo root:

```bash
nub ci
```

## Run the app

From `examples/basic-app/`:

```bash
nub run ios
# or
nub run android
```

This performs a native build and starts Metro. Leave it running while you execute tests.

## Run E2E tests

From `examples/basic-app/`, the platform gates run through the `rn-driver` CLI,
configured by [`rn-driver.config.ts`](./rn-driver.config.ts):

```bash
nub run test:e2e:android   # rn-driver test --platform android
nub run test:e2e:ios       # rn-driver test --platform ios
nub run test:e2e           # rn-driver test --platform all
```

The runner owns the whole native lifecycle — simulator/emulator selection, Metro,
the touch companion, secure token passing, Hermes target wait, cleanup — then
sets the driver's environment-variable contract (`RN_TOUCH_BACKEND` is
`instrumentation` on Android, `xctest` on iOS) and invokes Playwright. You no
longer set those variables by hand. The Playwright config should not use
`globalSetup` or `globalTeardown` to start Metro, launch the app, manage the
companion, or clean up runner-owned companion state.

The previous hand-rolled shell recipes remain as escape hatches:

```bash
nub run test:e2e:ios:bash       # scripts/e2e-ios-xctest.sh
nub run test:e2e:android:bash   # scripts/e2e-android-instrumentation.sh
```

## Driver configuration

The runner sets the driver's runtime environment-variable contract for you
(`RN_METRO_URL`, `RN_DEVICE_NAME`, `RN_TIMEOUT`, `RN_TOUCH_BACKEND`, and the
companion port/token-file vars). To change them, edit `rn-driver.config.ts`
(e.g. `timeoutMs`, `metro`, `ios`/`android` device selection) rather than
exporting environment variables.

This app is configured as a plain Expo/RN app, not an Expo dev-client app:
`ios.launch.kind` and `android.launch.kind` are both `plain`. Dev-client projects
need the runner package docs' extra launch config, including an Android
`scheme`. `launch.initialUrl` defaults to the resolved Metro URL for dev-client
launches.

`expo prebuild` runs inside the runner process and inherits that process
environment. The intended stable marker for test-only app config is `RN_E2E=1`,
but the runner does not emit it yet; do not rely on it as implemented behavior in
this example.

## Notes

- The app entry (`index.ts`) installs the driver harness unconditionally for convenience in this example. In real apps, follow the dev-only harness pattern described in the root README.
- Native modules are pulled in via workspace dependencies; if you remove a module, related tests will skip based on reported capabilities.

## Useful scripts

From `examples/basic-app/`:

```bash
nub run typecheck
nub run knip
nub run cpd
```

## Troubleshooting

- If tests can’t connect, make sure Metro is running and the app is built with Hermes.
- If locators or screenshots don’t work, ensure the corresponding native module is installed and rebuilt.
