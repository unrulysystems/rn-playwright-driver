# XCTest Touch Companion

Run this XCTest-based WebSocket companion alongside your app to inject OS-level touches. This mirrors idb-style input but is driven by `@unrulysystems/rn-playwright-driver` over a WebSocket channel.

## Usage

Install the package in the app under test and add the Expo config plugin:

```bash
bun add -d @unrulysystems/rn-playwright-driver-xctest-companion
```

```json
{
  "expo": {
    "plugins": ["@unrulysystems/rn-playwright-driver-xctest-companion"]
  }
}
```

During `expo prebuild`, the plugin scaffolds an iOS UI test target containing:

- `RNDriverTouchCompanion.swift`, the WebSocket touch server;
- `RNDriverTouchCompanionTests.swift`, the XCTest runner;
- `RNDriverTouchCompanionRuntimeConfig.json`, the resource used when Xcode does
  not propagate test environment variables;
- a shared scheme named `<AppName>UITests`.

If the iOS project already exists or the config plugin cannot be used, run the
scaffold directly:

```bash
npx rn-driver-xctest-scaffold --ios-dir ios --project-name <AppName>
```

The generated companion runs as the UI test
`<AppName>UITests/RNDriverTouchCompanionTests/testRunServer`. Connect the driver
with `RN_TOUCH_BACKEND=xctest` or explicit `touch.xctest` options:

```ts
const device = createDevice({
  touch: {
    mode: 'auto',
    xctest: {
      host: '127.0.0.1',
      port: 9999,
      authToken: process.env.RN_TOUCH_XCTEST_TOKEN,
    },
  },
})
```

## Manual Simulator Flow

Regenerate the native project and scaffold the companion target:

```bash
npx expo prebuild --platform ios
npx rn-driver-xctest-scaffold --ios-dir ios --project-name <AppName>
pod install --project-directory=ios
```

Create a per-run token file and runtime config. The config points XCTest at the
token file; the token itself stays out of command arguments. `launch` defaults to
`"launch"` for plain Expo apps. Use `"attach"` when a host script opens the app
itself, such as an Expo dev-client deep link.

```bash
export RN_TOUCH_XCTEST_PORT="${RN_TOUCH_XCTEST_PORT:-9999}"
export RN_TOUCH_XCTEST_TOKEN_FILE="$(mktemp -t rn-driver-xctest-token.XXXXXX)"
export RN_TOUCH_XCTEST_CONFIG_FILE="$(mktemp -t rn-driver-xctest-config.XXXXXX.json)"
chmod 600 "$RN_TOUCH_XCTEST_TOKEN_FILE" "$RN_TOUCH_XCTEST_CONFIG_FILE"
openssl rand -hex 16 >"$RN_TOUCH_XCTEST_TOKEN_FILE"
printf '{"port":%s,"authTokenFile":"%s"}' \
  "$RN_TOUCH_XCTEST_PORT" \
  "$RN_TOUCH_XCTEST_TOKEN_FILE" \
  >"$RN_TOUCH_XCTEST_CONFIG_FILE"
cp "$RN_TOUCH_XCTEST_CONFIG_FILE" \
  "ios/<AppName>UITests/RNDriverTouchCompanionRuntimeConfig.json"
```

For Expo development builds (`expo-dev-client`), write `"launch":"attach"` to
the runtime config, start the companion UI test, then open the app with the
development-client URL from the host:

```bash
printf '{"port":%s,"authTokenFile":"%s","launch":"attach"}' \
  "$RN_TOUCH_XCTEST_PORT" \
  "$RN_TOUCH_XCTEST_TOKEN_FILE" \
  >"$RN_TOUCH_XCTEST_CONFIG_FILE"

xcrun simctl openurl <UDID> \
  'exp+<scheme>://expo-development-client/?url=http://127.0.0.1:8081'
```

The companion also accepts `RN_TOUCH_XCTEST_LAUNCH=attach` or
`RN_TOUCH_XCTEST_LAUNCH_MODE=attach` when the XCTest environment propagates host
environment variables. The runtime config is preferred for scripts because Xcode
scheme environment propagation can be inconsistent.

The example script exposes the same attach flow with environment variables:

```bash
RN_TOUCH_XCTEST_LAUNCH=attach \
RN_TOUCH_XCTEST_APP_LAUNCH_URL='exp+<scheme>://expo-development-client/?url=http://127.0.0.1:8081' \
nub run test:e2e:ios
```

Build the app, then start the companion UI test in the background:

```bash
xcodebuild build \
  -workspace ios/<AppName>.xcworkspace \
  -scheme <AppName> \
  -destination 'platform=iOS Simulator,name=iPhone 15 Pro'

RN_TOUCH_XCTEST_PORT="$RN_TOUCH_XCTEST_PORT" \
RN_TOUCH_XCTEST_CONFIG_FILE="$RN_TOUCH_XCTEST_CONFIG_FILE" \
xcodebuild test \
  -workspace ios/<AppName>.xcworkspace \
  -scheme <AppName>UITests \
  -destination 'platform=iOS Simulator,name=iPhone 15 Pro' \
  -only-testing:<AppName>UITests/RNDriverTouchCompanionTests/testRunServer &
```

Run Playwright against the companion:

```bash
RN_TOUCH_BACKEND=xctest \
RN_TOUCH_XCTEST_PORT="$RN_TOUCH_XCTEST_PORT" \
RN_TOUCH_XCTEST_TOKEN_FILE="$RN_TOUCH_XCTEST_TOKEN_FILE" \
nub run test:e2e
```

For an end-to-end automation script, use
`examples/basic-app/scripts/e2e-ios-xctest.sh` as the reference. It selects and
boots a simulator, writes the runtime config, starts Metro, starts the companion
UI test, waits for Hermes/CDP, runs Playwright with `RN_TOUCH_BACKEND=xctest`,
and cleans up the XCTest process.

## Auth

Auth is required. For host-driven runs, prefer a 0600 token file and pass its
contents to the driver with `RN_TOUCH_XCTEST_TOKEN_FILE`. The generated XCTest
test reads `RN_TOUCH_XCTEST_TOKEN` when Xcode provides it, or a runtime config
file named by `RN_TOUCH_XCTEST_CONFIG_FILE`. When Xcode does not propagate test
environment variables, it falls back to the bundled
`RNDriverTouchCompanionRuntimeConfig.json` resource. The config contains `port`,
`authTokenFile`, and optional `launch` fields; the token itself stays in the
separate 0600 file.
The example e2e script writes a randomized per-run config and copies it into the
generated UI test target before build.

## Launch modes

- `launch` (default): the companion calls `XCUIApplication().launch()` before
  starting the WebSocket server. Use this for plain Expo/RN apps that connect to
  Metro on cold launch.
- `activate`: the companion foregrounds the app with `activate()` before
  starting the server.
- `attach`: the companion starts the server without launching or activating the
  app. Use this for Expo dev-client apps where the host must open a deep link to
  load the Metro bundle.

## Protocol

The companion accepts JSON messages over WebSocket. Each message includes `id`
and `type` fields, plus `authToken` when auth is enabled, and responds with
`{ id, ok: true }` or `{ id, ok: false, error: { message, code } }`.

Supported commands: `hello`, `tap`, `down`, `move`, `up`, `swipe`, `longPress`, `typeText`.

## Notes

- Coordinates are logical points (same as React Native).
- `swipe` duration is best-effort on iOS due to XCTest gesture limitations.
- XCTest does not expose a true incremental touch stream. `down` and `move`
  buffer a path and the companion injects that path when `up` is received.
