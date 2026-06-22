# Android Instrumentation Touch Companion

Runs a lightweight HTTP server inside an Instrumentation process and injects OS-level touch events via `UiAutomation.injectInputEvent`.

## Usage

1. Add the Kotlin class `RNDriverTouchCompanion` to an Android test module.
2. Register the instrumentation in your `AndroidManifest.xml`:

```xml
<instrumentation
  android:name="com.rndriver.touchcompanion.RNDriverTouchCompanion"
  android:targetPackage="your.app.id"
  android:functionalTest="false"
  android:handleProfiling="false" />
```

3. Start the instrumentation on device:

```bash
adb shell am instrument -w com.your.test/com.rndriver.touchcompanion.RNDriverTouchCompanion
```

4. Configure the driver:

```ts
const device = createDevice({
  touch: {
    mode: 'auto',
    instrumentation: { host: '127.0.0.1', port: 9999 },
  },
})
```

## Protocol

POST `/command` with JSON body:

```typescript
// Request
type TouchCommand =
  | { type: "hello" }
  | { type: "tap"; x: number; y: number }
  | { type: "down"; x: number; y: number }
  | { type: "move"; x: number; y: number }
  | { type: "up" }
  | { type: "swipe"; from: { x, y }; to: { x, y }; durationMs: number }
  | { type: "longPress"; x: number; y: number; durationMs: number }
  | { type: "typeText"; text: string };

// Response
{ ok: true } | { ok: false, error: { message: string, code?: string } }
```

## Notes

- Coordinates are logical points (dp). The companion converts to pixels using display density.
- Port forwarding may be required depending on device connection.
