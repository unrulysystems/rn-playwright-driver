# Advanced Usage

This guide covers advanced configuration and usage patterns for rn-playwright-driver.

## CDP Targeting

### Multiple Devices

When multiple devices are connected, use targeting options to select the correct one:

```typescript
import { createDevice } from '@0xbigboss/rn-playwright-driver'

// Target by device ID
const device = createDevice({
  deviceId: '00008030-001234567890',
})

// Target by device name (substring match)
const device = createDevice({
  deviceName: 'iPhone 15',
})

// Target by app ID
const device = createDevice({
  appId: 'com.myapp.example',
})
```

### Direct CDP Access

For advanced debugging, access the CDP client directly:

```typescript
import { CDPClient, discoverTargets, selectTarget } from '@0xbigboss/rn-playwright-driver'

// Discover all targets
const targets = await discoverTargets('http://localhost:8081')
console.log('Available targets:', targets)

// Select specific target
const target = selectTarget(targets, { deviceName: 'iPhone' })

// Connect CDP client
const cdp = new CDPClient({ timeout: 30000, autoReconnect: true })
await cdp.connect(target.webSocketDebuggerUrl, {
  id: target.id,
  url: target.url,
})

// Low-level evaluate
const result = await cdp.evaluate("require('react-native').Platform.OS")
```

### Auto-Reconnect

Enable auto-reconnect for flaky connections:

```typescript
const cdp = new CDPClient({
  timeout: 30000,
  autoReconnect: true,
  maxReconnectAttempts: 3,
  reconnectBackoffMs: 1000, // Doubles each attempt
})
```

## Timeout Configuration

### Global Timeouts

```typescript
const device = createDevice({
  timeout: 60000, // 60 second global timeout
})
```

### Per-Operation Timeouts

```typescript
// waitFor timeout
await device.getByTestId('slow-element').waitFor({
  state: 'visible',
  timeout: 10000,
})

// waitForFunction timeout
await device.waitForFunction('globalThis.appReady === true', { timeout: 5000, polling: 100 })
```

## Wait States

The `waitFor` method supports four states:

```typescript
// Wait for element to exist (attached to view tree)
await locator.waitFor({ state: 'attached' })

// Wait for element to be visible (exists AND visible: true)
await locator.waitFor({ state: 'visible' }) // default

// Wait for element to be hidden (exists but visible: false)
await locator.waitFor({ state: 'hidden' })

// Wait for element to be removed (does NOT exist)
await locator.waitFor({ state: 'detached' })
```

## Capabilities Detection

Check available features at runtime:

```typescript
const caps = await device.capabilities()

if (caps.viewTree) {
  // Locators are available
  await device.getByTestId('button').tap()
} else {
  // Fall back to coordinate-based tapping
  const bounds = await device.evaluate("getElementBounds('button')")
  await device.pointer.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
}

if (caps.screenshot) {
  const screenshot = await device.screenshot()
}

if (caps.lifecycle) {
  await device.background()
  await device.foreground()
}
```

## Custom Harness Configuration

### Dev-Only Harness

Use the dev entry point for production-safe builds:

```typescript
// Only installs when __DEV__ or globalThis.__E2E__ is true
import '@0xbigboss/rn-playwright-driver/harness/dev'
```

### Explicit E2E Mode

For production E2E testing:

```typescript
// Set before import
globalThis.__E2E__ = true
import '@0xbigboss/rn-playwright-driver/harness/dev'
```

### Custom Touch Handler

JS touch handler registration has been removed in favor of native touch injection.
Use `@0xbigboss/rn-driver-touch` and drive interactions via `device.pointer.*` in tests.

## Error Handling

### Locator Errors

```typescript
import { LocatorError } from '@0xbigboss/rn-playwright-driver'

try {
  await device.getByTestId('missing').waitFor({ timeout: 1000 })
} catch (e) {
  if (e instanceof LocatorError) {
    console.log('Code:', e.code) // "NOT_FOUND", "TIMEOUT", etc.
  }
}
```

### CDP Errors

CDP errors now include expression context:

```
Error: CDP evaluate failed: ReferenceError [target: http://localhost:8081/...]
Expression: globalThis.__RN_DRIVER__.viewTree.findByTestId("test")...
```

### Timeout Errors

```typescript
import { TimeoutError } from '@0xbigboss/rn-playwright-driver'

try {
  await device.waitForFunction('globalThis.ready', { timeout: 5000 })
} catch (e) {
  if (e instanceof TimeoutError) {
    console.log('Timed out waiting for app')
  }
}
```

## Pointer Interactions

### Basic Touch

```typescript
// Tap at coordinates
await device.pointer.tap(100, 200)

// Press and hold
await device.pointer.down(100, 200)
await device.waitForTimeout(500)
await device.pointer.up()

// Drag gesture
await device.pointer.drag(
  { x: 100, y: 200 },
  { x: 300, y: 200 },
  { steps: 10, holdStart: 16, holdEnd: 16 },
)
```

### Swipe Gestures

```typescript
// Swipe left
await device.pointer.swipe({
  from: { x: 300, y: 400 },
  to: { x: 50, y: 400 },
  duration: 300,
  easing: 'ease-out',
})

// Swipe up (scroll down)
await device.pointer.swipe({
  from: { x: 200, y: 600 },
  to: { x: 200, y: 200 },
  duration: 300,
  easing: 'ease-out',
})
```

## Screenshots

### Full Screen

```typescript
const fullScreen = await device.screenshot()
await fs.writeFile('screenshot.png', fullScreen)
```

### Element Screenshot

```typescript
const button = device.getByTestId('submit')
const buttonScreenshot = await button.screenshot()
```

### Region Screenshot

```typescript
const region = await device.screenshot({
  clip: { x: 0, y: 100, width: 200, height: 100 },
})
```

## Deep Linking

```typescript
// Open URL in app
await device.openURL('myapp://profile/123')

// Navigate to specific screen
await device.openURL('myapp://settings/notifications')
```

## App Lifecycle

```typescript
// Background the app
await device.background()

// Wait for some time
await device.waitForTimeout(5000)

// Bring back to foreground
await device.foreground()

// Reload JavaScript
await device.reload()
```

## Core Primitives

### Window Metrics

Get current window dimensions and display properties. All values are in logical points (not physical pixels):

```typescript
const metrics = await device.getWindowMetrics()
console.log('Screen:', metrics.width, 'x', metrics.height)
console.log('Pixel ratio:', metrics.pixelRatio)
console.log('Orientation:', metrics.orientation) // "portrait" | "landscape"
console.log('Font scale:', metrics.fontScale)

// Safe area insets (if react-native-safe-area-context installed)
if (metrics.safeAreaInsets) {
  console.log('Top inset:', metrics.safeAreaInsets.top)
}
```

### Frame Timing

Wait for animation frames to stabilize UI state before assertions:

```typescript
// Get current frame count
const frame = await device.getFrameCount()

// Wait for a single animation frame
await device.waitForRaf()

// Wait for multiple frames (useful for animations)
await device.waitForRaf(3)

// Wait until frame count reaches a target
await device.waitForFrameCount(frame + 10)
```

### Pointer Paths

Execute complex gestures along a path of points:

```typescript
// Drag along a curved path (e.g., bezier curve waypoints)
await device.pointer.dragPath(
  [
    { x: 100, y: 400 },
    { x: 150, y: 300 },
    { x: 200, y: 350 },
    { x: 250, y: 200 },
  ],
  { delay: 10 },
)

// Move without press (hover or track gesture)
await device.pointer.movePath([
  { x: 100, y: 100 },
  { x: 200, y: 100 },
  { x: 200, y: 200 },
])
```

### Touch Backend Info

Get diagnostic information about the selected touch backend:

```typescript
const info = await device.getTouchBackendInfo()
console.log('Selected backend:', info.selected)
console.log('Available backends:', info.available)
if (info.reason) {
  console.log('Selection reason:', info.reason)
}
```

### Event Tracing

Trace driver events for debugging complex interactions:

```typescript
// Start tracing (with optional console log capture)
await device.startTracing({ includeConsole: true })

// Perform some actions
await device.getByTestId('button').tap()
await device.waitForRaf(2)

// Stop and get traced events
const { events } = await device.stopTracing()
for (const event of events) {
  console.log(`[${event.timestamp}] ${event.type}`, event.data)
}
```

Event types: `pointer:down`, `pointer:move`, `pointer:up`, `pointer:tap`, `locator:find`, `locator:tap`, `evaluate`, `console`, `error`.

## Coordinate System

All coordinates throughout the driver are in **logical points** (not physical pixels):

- Origin (0, 0) is the top-left corner of the screen
- Values match React Native's coordinate system
- To convert to pixels, multiply by `metrics.pixelRatio`
- All API returns use logical points: `Locator.bounds()`, `getWindowMetrics()`, pointer coordinates

```typescript
const metrics = await device.getWindowMetrics()
const logicalX = 100
const physicalX = logicalX * metrics.pixelRatio

// Locator bounds are also in logical points
const button = device.getByTestId('submit')
const bounds = await button.bounds()
console.log('Button at:', bounds.x, bounds.y) // Logical points
console.log('Button size:', bounds.width, bounds.height) // Logical points
```
