# Touch Backend Implementation Tasks

Detailed implementation tasks for touch injection backends. See `NATIVE-MODULES-ARCHITECTURE.md` for full architecture.

## Status Overview

| Component | Status | Notes |
|-----------|--------|-------|
| TouchBackend interface | ✅ Complete | `packages/driver/src/touch/backend.ts` |
| Backend factory + types | ✅ Complete | `packages/driver/src/touch/index.ts` |
| HarnessTouchBackend | ✅ Complete | JS harness pointer calls |
| NativeModuleTouchBackend | ✅ Complete | Driver-side client via CDP |
| XCTestTouchBackend | ✅ Complete | WebSocket client to companion |
| InstrumentationTouchBackend | ✅ Complete | HTTP client to companion |
| CliTouchBackend | 🔶 Stub | Needs idb/adb implementation |
| XCTest Companion (iOS) | ✅ Reference impl (manual integration) | `packages/xctest-companion/` |
| Instrumentation Companion (Android) | ✅ Reference impl (manual integration) | `packages/instrumentation-companion/` |
| RNDriverTouchInjector (iOS) | ❌ Not started | Native module for Tier 2 |
| RNDriverTouchInjector (Android) | ❌ Not started | Native module for Tier 2 |
| Harness touchNative bridge | ✅ Complete | Types in harness, wiring ready |

---

## Tier 1: Companion Processes (OS-level) ✅

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

---

## Tier 2: Native Module Touch Injector

In-app touch synthesis for network-capable testing. Lower priority than companions since they provide OS-level injection already.

### Task: Create RNDriverTouchInjector package

```
packages/touch-injector/
├── ios/
│   ├── RNDriverTouchInjector.podspec
│   └── RNDriverTouchInjectorModule.swift
├── android/
│   ├── build.gradle
│   └── src/main/java/expo/modules/rndrivertouchinjector/
│       └── RNDriverTouchInjectorModule.kt
├── src/
│   ├── index.ts
│   └── RNDriverTouchInjectorModule.ts
├── expo-module.config.json
└── package.json
```

### iOS Implementation Tasks

- [ ] **Create Expo module scaffold** (`expo-module.config.json`, podspec)
- [ ] **Implement TouchSynthesizer class**
  - Use `UIApplication.sendEvent()` with synthesized UITouch/UIEvent
  - Track active touch state for down/move/up sequences
  - Use KVC to set private UITouch properties (same as KIF/EarlGrey)
- [ ] **Implement module functions**
  - `tap(x, y)` → synthesize down + up
  - `down(x, y)` → begin touch
  - `move(x, y)` → update touch location
  - `up()` → end touch
  - `swipe(fromX, fromY, toX, toY, durationMs)` → interpolated move sequence
  - `longPress(x, y, durationMs)` → down + delay + up (duration derived from driver LongPressOptions)
  - `typeText(text)` → return NOT_SUPPORTED (requires keyboard focus)
- [ ] **Return NativeResult<void>** for all functions
- [ ] **Handle coordinate conversion** (logical points, not pixels)

**Reference implementation** (from architecture doc):
```swift
func synthesizeTap(at point: CGPoint) {
  guard let window = UIApplication.shared.windows.first,
        let hitView = window.hitTest(point, with: nil) else { return }

  let touch = createTouch(at: point, in: window, view: hitView, phase: .began)
  let event = createTouchEvent(with: touch)
  UIApplication.shared.sendEvent(event)
  // ... dispatch .ended phase
}
```

### Android Implementation Tasks

- [ ] **Create Expo module scaffold**
- [ ] **Implement touch synthesis**
  - Use `view.dispatchTouchEvent()` with MotionEvent
  - Find target view via `window.decorView` hit testing
  - Track activeDownTime for down/move/up sequences
- [ ] **Implement module functions** (same as iOS)
- [ ] **Convert dp to pixels** using display density
- [ ] **Return NativeResult<void>**

**Reference implementation**:
```kotlin
fun synthesizeTap(x: Float, y: Float) {
  val view = findViewAt(activity.window.decorView, x, y) ?: return
  val downTime = SystemClock.uptimeMillis()

  val down = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, x, y, 0)
  view.dispatchTouchEvent(down)
  down.recycle()

  val up = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, x, y, 0)
  view.dispatchTouchEvent(up)
  up.recycle()
}
```

### Harness Integration

- [x] **TouchNativeBridge type** defined in harness
- [x] **Capability flag** `touchNative` in capabilities
- [ ] **Wire up module** when RNDriverTouchInjector is created

---

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

**Location**: `example/e2e/touch-backends.spec.ts`

- [ ] **Test HarnessTouchBackend**
  - Verify tap triggers onPress
  - Verify swipe triggers scroll

- [ ] **Test NativeModuleTouchBackend** (when module exists)
  - Same scenarios as harness
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

- [ ] **touch-injector** (when implemented)
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
    mode: "force",
    backend: "xctest",  // or "instrumentation", "harness", etc.
  },
});
```

### Default (Harness)
```bash
cd example
bun run test:e2e  # Falls back to JS harness if no companion is running
```
