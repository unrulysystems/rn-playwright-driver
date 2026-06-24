# Touch Backend Implementation Tasks

Detailed implementation tasks for touch injection backends. See `NATIVE-MODULES-ARCHITECTURE.md` for full architecture.

## Status Overview

| Component                           | Status                                 | Notes                                                                |
| ----------------------------------- | -------------------------------------- | -------------------------------------------------------------------- |
| TouchBackend interface              | ✅ Complete                            | `packages/driver/src/touch/backend.ts`                               |
| Backend factory + types             | ✅ Complete                            | `packages/driver/src/touch/index.ts`                                 |
| NativeModuleTouchBackend            | ✅ Complete                            | Driver-side client via CDP                                           |
| XCTestTouchBackend                  | ✅ Complete                            | WebSocket client to companion                                        |
| InstrumentationTouchBackend         | ✅ Complete                            | HTTP client to companion                                             |
| CliTouchBackend                     | 🔶 Stub                                | Needs idb/adb implementation                                         |
| XCTest Companion (iOS)              | ✅ Reference impl (manual integration) | `packages/xctest-companion/`                                         |
| Instrumentation Companion (Android) | ✅ Reference impl (manual integration) | `packages/instrumentation-companion/`                                |
| RNDriverTouchInjector (iOS)         | ✅ Implemented                         | DEBUG builds only; uses UIKit private touch synthesis                |
| RNDriverTouchInjector (Android)     | ✅ Implemented                         | Requires Android instrumentation to provide `Instrumentation`        |
| Harness touchNative bridge          | ✅ Complete                            | Loads `RNDriverTouchInjector` and exposes `capabilities.touchNative` |

## Current Defaults

`createTouchBackend()` currently defaults to `["native-module"]` on both iOS and Android. This means `device.connect()` fails fast when `@unrulysystems/rn-driver-touch` is absent from the tested app instead of silently falling back to a less capable path.

Use explicit configuration for companion runs:

```ts
createDevice({
  touch: {
    order: ['instrumentation', 'native-module'],
    instrumentation: { port: 9999 },
  },
})
```

`cli` remains a typed placeholder and should not appear in default orders until idb/adb execution, device selection, timeout handling, and shell escaping are implemented. The previous JS harness fallback has been removed from the current source surface.

---

## Tier 1: Native Module Touch Injector ✅

In-app touch synthesis is the current default because it is packaged with the tested app and can be detected through the harness capability flag.

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

## Tier 2: Companion Processes (OS-level) ✅

Both companion processes are implemented as reference code. Integrate into your app's test target to use.

### XCTest Companion (iOS)

- **Location**: `packages/xctest-companion/ios/RNDriverTouchCompanion.swift`
- **Status**: Reference impl (manual integration)
- **Features**: hello, tap, down/move/up, swipe, longPress, typeText
- **Protocol**: WebSocket on port 9999
  - Request: `{ id, type: "tap", x, y }`
  - Response: `{ id, ok: true }` or `{ id, ok: false, error: { message, code? } }`
- **Injection**: XCUICoordinate → IOHIDEvent (kernel-level)

**Usage**:

Integrate `RNDriverTouchCompanion.swift` into your app's UI test target, then run your test scheme to start the companion server. See `packages/xctest-companion/README.md` for details.

### Instrumentation Companion (Android)

- **Location**: `packages/instrumentation-companion/android/src/main/java/com/rndriver/touchcompanion/RNDriverTouchCompanion.kt`
- **Status**: Reference impl (manual integration)
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

## Tier 3: CLI Backend (idb/adb)

Fallback for when companions aren't running but CLI tools are available.

### Task: Implement CliTouchBackend

**Location**: `packages/driver/src/touch/cli-backend.ts`

- [ ] **iOS (idb)**
  - Detect idb availability: `which idb`
  - Implement tap: `idb ui tap <x> <y>`
  - Implement swipe: `idb ui swipe <x1> <y1> <x2> <y2> --duration <s>`
  - Implement typeText: `idb ui text "<text>"`
  - Handle coordinate system (idb uses points)

- [ ] **Android (adb)**
  - Detect adb availability: `which adb`
  - Implement tap: `adb shell input tap <x> <y>`
  - Implement swipe: `adb shell input swipe <x1> <y1> <x2> <y2> <duration_ms>`
  - Implement typeText: `adb shell input text "<text>"`
  - Convert dp to pixels using device density

- [ ] **Process spawning**
  - Use `child_process.spawn` for non-blocking execution
  - Parse stdout/stderr for error detection
  - Handle timeouts

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

- [ ] **xctest-companion**
  - Add proper package.json with bin scripts
  - Add Xcode project for building
  - Document integration with app's test target

- [ ] **instrumentation-companion**
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
# Terminal 1: Start companion
# Integrate RNDriverTouchCompanion.swift into your app's UI test target
# Then run your UI test scheme to start the companion server

# Terminal 2: Run tests (auto-selects xctest backend if companion is running)
cd example
bun run test:e2e
```

### Android with Instrumentation Companion

```bash
# Terminal 1: Start companion
# Integrate RNDriverTouchCompanion.kt into your androidTest target
# Then run: adb shell am instrument -w <your.test.pkg>/com.rndriver.touchcompanion.RNDriverTouchCompanion

# Terminal 2: Run tests (auto-selects instrumentation backend if companion is running)
cd example
bun run test:e2e
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

### Default (native-module)

```bash
cd example
bun run test:e2e  # Default backend order resolves to native-module
```
