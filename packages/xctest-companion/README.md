# XCTest Touch Companion

Run this XCTest-based WebSocket companion alongside your app to inject OS-level touches. This mirrors idb-style input but is driven by `@unrulysystems/rn-playwright-driver` over a WebSocket channel.

## Usage

1. Install the package and add the Expo config plugin, or run
   `rn-driver-xctest-scaffold --ios-dir ios` after the iOS project exists.
2. Build/run the generated shared UI test scheme
   `<AppName>UITests/RNDriverTouchCompanionTests/testRunServer`.
3. Connect the driver with `RN_TOUCH_BACKEND=xctest` or explicit `touch.xctest`
   options:

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

Auth is required. For host-driven runs, prefer a 0600 token file and pass its
contents to the driver with `RN_TOUCH_XCTEST_TOKEN_FILE`. The generated XCTest
test reads `RN_TOUCH_XCTEST_TOKEN` when Xcode provides it, or a runtime config
file named by `RN_TOUCH_XCTEST_CONFIG_FILE`. When Xcode does not propagate test
environment variables, it falls back to the bundled
`RNDriverTouchCompanionRuntimeConfig.json` resource. The config contains `port`
and `authTokenFile` fields; the token itself stays in the separate 0600 file.
The example e2e script writes a randomized per-run config and copies it into the
generated UI test target before build.

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
