# Touch Backend Implementation Tasks

Detailed implementation tasks for touch injection backends. See `NATIVE-MODULES-ARCHITECTURE.md` for full architecture.

## Status Overview

| Component                           | Status               | Notes                                                                |
| ----------------------------------- | -------------------- | -------------------------------------------------------------------- |
| TouchBackend interface              | ✅ Complete          | `packages/driver/src/touch/backend.ts`                               |
| Backend factory + types             | ✅ Complete          | `packages/driver/src/touch/index.ts`                                 |
| NativeModuleTouchBackend            | ✅ Complete          | Driver-side client via CDP                                           |
| XCTestTouchBackend                  | ✅ Complete          | WebSocket client to companion                                        |
| InstrumentationTouchBackend         | ✅ Complete          | HTTP client to companion                                             |
| CliTouchBackend                     | ✅ Explicit fallback | Android adb input backend                                            |
| XCTest Companion (iOS)              | ✅ Scaffold/plugin   | `packages/xctest-companion/`                                         |
| Instrumentation Companion (Android) | ✅ Config plugin     | `packages/instrumentation-companion/`                                |
| RNDriverTouchInjector (iOS)         | ✅ Implemented       | DEBUG builds only; uses UIKit private touch synthesis                |
| RNDriverTouchInjector (Android)     | ✅ Implemented       | Requires Android instrumentation to provide `Instrumentation`        |
| Harness touchNative bridge          | ✅ Complete          | Loads `RNDriverTouchInjector` and exposes `capabilities.touchNative` |

## Current Defaults

`createTouchBackend()` currently defaults to the platform companion only:
`["xctest"]` on iOS and `["instrumentation"]` on Android. Auto mode fails closed
when the companion is unavailable instead of silently falling back to a less
faithful backend.

Use explicit configuration only for lower-fidelity escape hatches:

```ts
createDevice({
  touch: {
    mode: 'force',
    backend: 'native-module',
  },
})
```

The previous JS harness fallback has been removed from the current source
surface.

---

## Lower-Fidelity: Native Module Touch Injector ✅

In-app touch synthesis is available for fast local loops but is not the
confidence path. It is scoped to the app process/current app windows.

### iOS implementation

- **Location**: `packages/rn-driver-touch/ios/RNDriverTouchInjectorModule.swift`
- **Status**: Implemented for DEBUG builds
- **Features**: tap, down/move/up, swipe, longPress, typeText
- **Caveat**: Uses private UIKit touch APIs and intentionally returns `NOT_SUPPORTED` in release builds.

### Android implementation

- **Location**: `packages/rn-driver-touch/android/src/main/java/expo/modules/rndrivertouch/RNDriverTouchInjectorModule.kt`
- **Status**: Implemented
- **Features**: tap, down/move/up, swipe, longPress, typeText
- **Caveat**: Resolves `Instrumentation` from AndroidX test registries. Plain app launches without instrumentation should use the companion backend or expect `NOT_SUPPORTED`.

---

## Tier 1: Companion Processes ✅

Companion processes are the confidence path for pointer input.

### XCTest Companion (iOS)

- **Location**: `packages/xctest-companion/ios/RNDriverTouchCompanion.swift`
- **Status**: Scaffold/plugin
- **Features**: hello, tap, down/move/up, swipe, longPress, typeText
- **Protocol**: WebSocket on port 9999
  - Request: `{ id, type: "tap", x, y }`
  - Response: `{ id, ok: true }` or `{ id, ok: false, error: { message, code? } }`
- **Injection**: XCUICoordinate → IOHIDEvent (kernel-level)

**Usage**:

Install the XCTest companion package/plugin or run `rn-driver-xctest-scaffold`; the scaffold copies the Swift files, creates/updates the app UI test target, and writes a shared companion scheme. See `packages/xctest-companion/README.md` for details.

### Instrumentation Companion (Android)

- **Location**: `packages/instrumentation-companion/android/src/main/java/com/rndriver/touchcompanion/RNDriverTouchCompanion.kt`
- **Status**: Config plugin
- **Features**: hello, tap, down/move/up, swipe, longPress, typeText
- **Protocol**: HTTP POST /command on port 9999
  - Request: `{ type: "tap", x, y }`
  - Response: `{ ok: true }` or `{ ok: false, error: { message, code? } }`
- **Injection**: UiAutomation.injectInputEvent (kernel-level)

**Usage**:

```bash
# See packages/instrumentation-companion/README.md for build instructions
adb shell am instrument -w \
  com.your.test/com.rndriver.touchcompanion.RNDriverTouchCompanion
```

## Explicit Fallback: CLI Backend (adb)

Lower-fidelity Android fallback for diagnostics when adb input is sufficient.

### Task: Implement CliTouchBackend

**Location**: `packages/driver/src/touch/cli-backend.ts`

- [ ] **iOS (idb)**
  - Detect idb availability: `which idb`
  - Implement tap: `idb ui tap <x> <y>`
  - Implement swipe: `idb ui swipe <x1> <y1> <x2> <y2> --duration <s>`
  - Implement typeText: `idb ui text "<text>"`
  - Handle coordinate system (idb uses points)

- [x] **Android (adb)**
  - Detect adb availability with `adb get-state`
  - Implement tap: `adb shell input tap <x> <y>`
  - Implement swipe: `adb shell input swipe <x1> <y1> <x2> <y2> <duration_ms>`
  - Implement typeText: `adb shell input text "<text>"`
  - Convert logical points to pixels using device density

- [x] **Process spawning**
  - Use bounded `execFile` calls for adb execution
  - Parse stdout/stderr for error detection
  - Handle command timeouts

---

## Integration Tests

### Task: Add backend integration tests

**Location**: `examples/basic-app/e2e/primitives/touch-backend.spec.ts` plus device-backed backend specs as they are added.

- [ ] **Test NativeModuleTouchBackend** (when module exists)
  - Verify tap triggers onPress
  - Verify swipe triggers scroll
  - Verify capability detection

- [ ] **Test XCTestTouchBackend** (requires companion running)
  - Verify connection
  - Verify tap/swipe work
  - Test keyboard input

- [ ] **Test InstrumentationTouchBackend** (requires companion running)
  - Same scenarios as XCTest

- [ ] **Test backend fallback**
  - Verify auto-selection picks best available
  - Verify graceful fallback when preferred unavailable

---

## Package Publishing

### Task: Prepare companion packages for npm

- [x] **xctest-companion**
  - Package includes `app.plugin.js`, `bin/rn-driver-xctest-scaffold`, Swift companion sources, runtime config placeholder, and scaffold helper
  - Scaffold creates/updates the app UI test target and shared companion scheme
  - README documents integration with the app's test target

- [x] **instrumentation-companion**
  - Add proper package.json
  - Add Gradle build setup
  - Document APK building and installation

- [ ] **rn-driver-touch** (when implemented)
  - Standard Expo module publishing
  - Add to example app dependencies

---

## Priority Order

1. **Companion packages work** - They're done and provide full OS-level capability
2. **CLI backend** - Provides fallback without extra setup
3. **Native module** - Nice-to-have for network testing, but companions cover most cases
4. **Integration tests** - Ensure everything works together

---

## Quick Start Testing

### iOS with XCTest Companion

```bash
cd examples/basic-app
bun run test:e2e:ios
```

### Android with Instrumentation Companion

```bash
cd examples/basic-app
bun run test:e2e:android
```

### Force Specific Backend

```typescript
// In test fixture or createDevice call
const device = createDevice({
  touch: {
    mode: 'force',
    // TouchBackendType: "xctest" | "instrumentation" | "native-module" | "cli"
    backend: 'xctest',
  },
})
```

### Default companion-backed e2e

```bash
cd examples/basic-app
bun run test:e2e:android
bun run test:e2e:ios
```
