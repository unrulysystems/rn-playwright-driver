# Example App (RN Playwright Driver)

Minimal Expo app used to validate the RN Playwright Driver end-to-end. It ships a tiny counter UI plus Playwright tests that exercise the driver API, optional native modules, and view-tree locators.

## What’s inside

- Expo app entry: `index.ts` (installs the driver harness)
- UI under test: `App.tsx` (counter with testIDs)
- E2E tests: `e2e/counter.spec.ts`
- Playwright config: `playwright.config.ts`

## Prerequisites

- Node.js 18+
- Bun
- Expo tooling installed
- A simulator/device with Hermes debugging enabled

## Install

From repo root:

```bash
bun install
```

## Run the app

From `example/`:

```bash
bun run ios
# or
bun run android
```

This performs a native build and starts Metro. Leave it running while you execute tests.

## Run E2E tests

From `examples/basic-app/`, the platform gates run through the `rn-driver` CLI,
configured by [`rn-driver.config.ts`](./rn-driver.config.ts):

```bash
bun run test:e2e:android   # rn-driver test --platform android
bun run test:e2e:ios       # rn-driver test --platform ios
bun run test:e2e           # rn-driver test --platform all
```

The runner owns the whole native lifecycle — simulator/emulator selection, Metro,
the touch companion, secure token passing, Hermes target wait, cleanup — then
sets the driver's environment-variable contract (`RN_TOUCH_BACKEND` is
`instrumentation` on Android, `xctest` on iOS) and invokes Playwright. You no
longer set those variables by hand.

The previous hand-rolled shell recipes remain as escape hatches:

```bash
bun run test:e2e:ios:bash       # scripts/e2e-ios-xctest.sh
bun run test:e2e:android:bash   # scripts/e2e-android-instrumentation.sh
```

## Driver configuration

The runner sets the driver's runtime environment-variable contract for you
(`RN_METRO_URL`, `RN_DEVICE_NAME`, `RN_TIMEOUT`, `RN_TOUCH_BACKEND`, and the
companion port/token-file vars). To change them, edit `rn-driver.config.ts`
(e.g. `timeoutMs`, `metro`, `ios`/`android` device selection) rather than
exporting environment variables.

## Notes

- The app entry (`index.ts`) installs the driver harness unconditionally for convenience in this example. In real apps, follow the dev-only harness pattern described in the root README.
- Native modules are pulled in via workspace dependencies; if you remove a module, related tests will skip based on reported capabilities.

## Useful scripts

From `example/`:

```bash
bun run check
bun run lint
bun run typecheck
```

## Troubleshooting

- If tests can’t connect, make sure Metro is running and the app is built with Hermes.
- If locators or screenshots don’t work, ensure the corresponding native module is installed and rebuilt.
