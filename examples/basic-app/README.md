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

From `examples/basic-app/`, use the companion-backed platform gates:

```bash
bun run test:e2e:android
bun run test:e2e:ios
```

These scripts build the native app, start Metro, start the platform touch
companion, and run the touch-oriented Playwright specs with
`RN_TOUCH_BACKEND=instrumentation` or `RN_TOUCH_BACKEND=xctest`.

## Driver configuration

The driver reads these environment variables at test runtime:

- `RN_METRO_URL` (default: `http://localhost:8081`)
- `RN_DEVICE_ID`
- `RN_DEVICE_NAME`
- `RN_TIMEOUT` (ms)
- `RN_TOUCH_BACKEND` (`instrumentation` on Android, `xctest` on iOS for the e2e gates)

Example:

```bash
RN_DEVICE_NAME="iPhone" RN_TIMEOUT=60000 bun run test:e2e
```

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
