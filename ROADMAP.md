# Roadmap

Future improvements for rn-playwright-driver, organized by effort and impact.

## Quick Wins

### GitHub Actions CI Workflow

- [x] Create `.github/workflows/ci.yml` for unit tests and linting
- [ ] Add self-hosted macOS runner for E2E tests with iOS Simulator
- [ ] Add Android emulator job for cross-platform coverage
- Reference: `docs/CI.md` has setup instructions

### Locator Assertions

Playwright-style expect matchers with auto-retry:

```typescript
await expect(locator).toBeVisible()
await expect(locator).toHaveText('Count: 5')
await expect(locator).toBeEnabled()
await expect(locator).toBeDisabled()
```

- [x] Create `packages/driver/src/expect.ts` with matcher implementations
- [x] Add polling/retry logic with configurable timeout
- [x] Export from `@unrulysystems/rn-playwright-driver/test`

### Keyboard Input

- [x] Implement `Locator.type(text)` for text input (stub with NOT_SUPPORTED - requires native module)
- [ ] Add `Locator.clear()` to clear input fields
- [ ] Add `Locator.press(key)` for special keys (Enter, Tab, Backspace)
- [ ] Requires native keyboard simulation or focus + text injection

### Scroll Gestures

```typescript
await locator.scrollIntoView()
await device.pointer.swipe({ from: { x, y }, to: { x, y2 }, duration: 300 })
```

- [x] Add `scrollIntoView()` to Locator (stub with NOT_SUPPORTED - requires native module)
- [x] Add `swipe()` to pointer interface
- [ ] Add `fling()` for fast scrolls

## Touch Backend Tiers (Phase 2.5)

OS-level touch injection matching idb/adb capabilities. See `docs/NATIVE-MODULES-ARCHITECTURE.md` for full architecture.

### Tier 1: Native Module Touch Injector (default)

In-app touch synthesis for the tested app. This is the current `auto` default on iOS and Android.

- [x] **RNDriverTouchInjector iOS**: DEBUG-only UIKit touch synthesis
- [x] **RNDriverTouchInjector Android**: Instrumentation-backed input injection
- [x] Driver backend (NativeModuleTouchBackend)
- [x] Harness integration (`touchNative` bridge and capability)
- [ ] Document Android instrumentation launch path for plain app runs
- [ ] Add device-backed integration tests for native-module touch

### Tier 2: XCTest/Instrumentation Companion (opt-in OS-level)

Kernel-level touch injection via companion process. Enables system UI interaction, keyboard input, and cross-app testing when the companion is manually integrated and started.

- [x] **XCTest Companion (iOS)**: WebSocket server using XCUICoordinate for IOHIDEvent injection
- [x] **Instrumentation Companion (Android)**: HTTP server using UiAutomation.injectInputEvent()
- [x] Driver backend clients (XCTestTouchBackend, InstrumentationTouchBackend)
- [x] Android companion package includes an Expo config plugin for androidTest integration

### Tier 3: CLI Backend (idb/adb)

Fallback to spawning idb/adb CLI commands for touch injection.

- [ ] CliTouchBackend with idb support
- [x] CliTouchBackend with adb support

### Touch Backend Infrastructure

- [x] TouchBackend interface definition
- [x] TouchBackendConfig types
- [x] Backend factory with auto-selection
- [x] Pointer class refactored to use TouchBackend
- [x] Harness touchNative bridge types
- [x] Android device smoke tests for adb CLI and instrumentation backends
- [x] Env parser for forcing `RN_TOUCH_BACKEND` and `RN_TOUCH_INSTRUMENTATION_PORT`

## Medium Effort

### Locator Chaining

Find elements within other elements:

```typescript
await device.getByTestId('login-form').getByRole('button', { name: 'Submit' }).tap()
await device.getByTestId('user-list').nth(2).getByText('Edit').tap()
```

- [x] Add `Locator.getByTestId()`, `getByText()`, `getByRole()` for scoped queries
- [x] Add `Locator.nth(index)` for selecting from multiple matches
- [x] Add `Locator.first()` and `Locator.last()` helpers
- [ ] Update native modules to support scoped queries (currently client-side filtering)

### Network Interception

Mock API responses for deterministic tests:

```typescript
await device.route('**/api/users', (route) => route.fulfill({ json: mockUsers }))
await device.route('**/api/auth', (route) => route.abort())
```

- [ ] Research Metro/Hermes network hooks
- [ ] Implement route matching with glob patterns
- [ ] Support fulfill, abort, and continue actions

### Element Inspector CLI

Interactive mode for exploring the view tree:

```bash
bun run inspect  # Launch inspector
```

- [x] Create `packages/driver/bin/inspect.ts` CLI
- [x] Real-time view tree display with refresh (`--watch` flag)
- [ ] Tap-to-select for generating locator code
- [x] Filter by testID, text, role (`--filter` flag)

### Visual Regression Testing

Screenshot comparison with diff detection:

```typescript
await expect(device.screenshot()).toMatchSnapshot('home-screen.png')
await expect(locator.screenshot()).toMatchSnapshot('button.png')
```

- [x] Implement `toMatchSnapshot()` for locators with pixel-level comparison (pixelmatch)
- [x] Add threshold configuration (`maxDiffPixelRatio`)
- [x] Save diff images on failure (visual diff highlighting pixel differences)
- [ ] Generate visual diff reports on failure (HTML reports with side-by-side comparison)

## Larger Initiatives

### Test Recorder

Record interactions and generate test code:

```bash
bun run record  # Start recording session
```

- [ ] Capture tap, type, and gesture events
- [ ] Generate Playwright-style test code
- [ ] Support editing and replaying recorded tests
- [ ] Similar to Playwright codegen

### Parallel Test Execution

Run tests across multiple devices simultaneously:

```typescript
// playwright.config.ts
export default {
  workers: 4,
  devices: ['iPhone 15', 'iPhone SE', 'Pixel 7', 'Pixel 4a'],
}
```

- [ ] Implement device pool management
- [ ] Add worker-based test distribution
- [ ] Support sharding across CI jobs

### React Navigation Integration

First-class navigation support:

```typescript
await device.navigation.navigate('Settings')
await device.navigation.goBack()
await device.navigation.waitForRoute('Profile')
const currentRoute = await device.navigation.getCurrentRoute()
```

- [ ] Detect React Navigation in app
- [ ] Bridge navigation state to driver
- [ ] Add navigation-specific waiters

### State Inspection

Access app state for debugging and assertions:

```typescript
const reduxState = await device.getReduxState()
const asyncStorageValue = await device.getAsyncStorage('user-token')
const recoilAtom = await device.getRecoilState('userAtom')
```

- [ ] Add harness hooks for Redux, Recoil, Zustand
- [ ] Implement AsyncStorage bridge
- [ ] Support MMKV and other storage solutions

### Multi-Touch Gestures

Complex gesture support:

```typescript
await device.pointer.pinch({ center: { x, y }, scale: 0.5 })
await device.pointer.rotate({ center: { x, y }, angle: 90 })
await device.pointer.multiTap(3) // Triple tap
```

- [ ] Implement multi-touch event synthesis
- [ ] Add gesture recognizer compatibility
- [ ] Test with maps, image viewers, etc.

## Platform Expansion

### Expo Web Support

- [ ] Add web driver using Puppeteer/Playwright
- [ ] Share locator API across platforms
- [ ] Cross-platform test runner

### tvOS Support

- [ ] Add focus-based navigation
- [ ] Remote control simulation
- [ ] tvOS-specific gestures

## Contributing

Want to work on something? Open an issue to discuss the approach before starting.
Priority is generally: Quick Wins > Medium Effort > Larger Initiatives.
