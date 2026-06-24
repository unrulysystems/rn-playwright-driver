# XCTest Touch Companion

Run this XCTest-based WebSocket companion alongside your app to inject OS-level touches. This mirrors idb-style input but is driven by `@unrulysystems/rn-playwright-driver` over a WebSocket channel.

## Usage

1. Add `RNDriverTouchCompanion.swift` to your UI test target.
2. Run the UI test `RNDriverTouchCompanionTests.testRunServer` on the device/simulator.
3. Ensure port forwarding from your host to the device (default: `9999`).
4. Configure the driver:

```ts
const device = createDevice({
  touch: {
    mode: 'auto',
    xctest: { host: '127.0.0.1', port: 9999 },
  },
})
```

## Protocol

The companion accepts JSON messages over WebSocket. Each message includes `id` and `type` fields and responds with `{ id, ok: true }` or `{ id, ok: false, error: { message, code } }`.

Supported commands: `hello`, `tap`, `down`, `move`, `up`, `swipe`, `longPress`, `typeText`.

## Notes

- Coordinates are logical points (same as React Native).
- `swipe` duration is best-effort on iOS due to XCTest gesture limitations.
