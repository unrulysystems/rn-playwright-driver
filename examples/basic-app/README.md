# Example App (RN Playwright Driver)

Minimal Expo app used to validate the RN Playwright Driver end-to-end. It ships a tiny counter UI plus Playwright tests that exercise the driver API, optional native modules, and view-tree locators.

## What's inside

- Expo app entry: `index.ts` (imports nothing from the driver; `metro.config.js` installs the harness)
- UI under test: `App.tsx` (counter with testIDs)
- E2E tests: `e2e/`
- Playwright config: `playwright.config.ts`

## Prerequisites

- Node.js 24.17.0 (repo `.node-version`)
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

### Real-device verification

Discover connected targets first:

```bash
adb devices -l
xcrun devicectl list devices
```

Android can run against either an emulator or a USB-attached Android device. If
more than one target is visible, pin the serial:

```bash
nub run test:e2e:android -- --device emulator-5554
nub run test:e2e:android -- --device <android-serial>
```

Physical iOS uses a dedicated Expo-dev-client config because real iPhones need a
phone-reachable Metro URL and host-owned `devicectl` launch:

```bash
nub exec rn-driver test --platform ios --config rn-driver.ios-device.config.ts --device <ios-udid-or-device-name>
nub run judge:visual
```

`rn-driver.ios-device.config.ts` starts Metro with `expo start --dev-client
--host lan`, auto-selects the first non-internal IPv4 address, and uses that
same LAN Metro URL for runner readiness, app launch, and CDP. The single origin
matters: Expo's inspector rejects a DevTools websocket when the app loads Metro
from the LAN URL but the driver asks for targets through loopback.

The physical iOS config runs the normal counter integration spec and then
`e2e/visual/ios-device-visual.spec.ts`, which writes blind visual judging
artifacts to `test-results/visual-judge/latest/`. `nub run judge:visual` is the
deterministic floor for those artifacts; after it passes, hand
`blind-judge-packets/*.md`, their PNGs, and paired state JSON files to at least
two independent subagent judges.

See [`docs/BLIND-VISUAL-JUDGING.md`](./docs/BLIND-VISUAL-JUDGING.md) for the
judge prompt contract and pass/fail policy.

Override the address when the auto-selected interface is not reachable from the iPhone:

```bash
RN_DRIVER_IOS_DEVICE_METRO_HOST=<mac-lan-ip> \
  nub exec rn-driver test --platform ios --config rn-driver.ios-device.config.ts --device <ios-udid-or-device-name>

RN_DRIVER_IOS_DEVICE_METRO_URL=https://<tunnel-host> \
  nub exec rn-driver test --platform ios --config rn-driver.ios-device.config.ts --device <ios-udid-or-device-name>
```

Use `--dry-run` first. The iOS physical-device plan should show
`devicectl device process launch`, `RN_IOS_TARGET_KIND=device`, and the
same LAN/tunnel URL in both the app `initialUrl` and `RN_METRO_URL`.

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

The default simulator/emulator config uses plain launch semantics:
`ios.launch.kind` and `android.launch.kind` are both `plain`. The dedicated
physical iOS config uses Expo dev-client launch semantics because real iPhones
need a device-reachable Metro URL and an app URL scheme.

`expo prebuild` runs inside the runner process and inherits that process
environment. The runner sets `RN_E2E=1` on every prebuild and on the Metro it
starts; the driver's Metro helper and config plugins read that marker, so this app
lists them unconditionally and never reads the marker itself.

`rn-driver.config.ts` also demonstrates `hooks.configureTarget`. The example
sets harmless target metadata env for Metro and Playwright; real apps can use the
same hook to choose app-owned Supabase/RPC/localnet/tunnel URLs for the selected
simulator or emulator. Keep runner-owned `RN_*` driver variables out of project
hook env.

## Notes

- The app entry (`index.ts`) imports nothing from the driver. `metro.config.js` wraps the default config in `withRnDriverHarness`, which serves the harness before the app entry only while the runner's `RN_E2E=1` marker is set; a release export never contains it.
- Native modules are pulled in via workspace dependencies; if you remove a module, related tests will skip based on reported capabilities.
- SDK 56 iOS builds set `expo.ios.deploymentTarget` to `16.4`.
- `npx expo-doctor@latest --verbose` should pass Expo SDK schema/version/native
  tooling checks. Its remaining failures are expected in this nub monorepo:
  `knip` is both a package script and local bin, the app uses the repo-root
  `lock.yaml` instead of an app-local npm/yarn/pnpm lockfile, and nub exposes
  same-version workspace package installs that Expo Doctor reports as duplicate
  native dependencies.

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
