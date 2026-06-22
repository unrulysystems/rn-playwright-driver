# API Stability

This document describes the stability of various APIs in rn-playwright-driver.

## Stability Levels

| Level            | Description                                      |
| ---------------- | ------------------------------------------------ |
| **Stable**       | Public API. Breaking changes follow semver.      |
| **Experimental** | May change in minor versions. Use with caution.  |
| **Internal**     | Not for external use. May change without notice. |

## Public API (Stable)

### Device Interface

The core `Device` interface is stable:

```typescript
interface Device {
  // Connection
  connect(): Promise<void>
  disconnect(): Promise<void>
  ping(): Promise<boolean>

  // Evaluation
  evaluate<T>(expression: string): Promise<T>
  waitForFunction<T>(expression: string, options?): Promise<T>
  waitForTimeout(ms: number): Promise<void>

  // Locators
  getByTestId(testId: string): Locator
  getByText(text: string, options?): Locator
  getByRole(role: string, options?): Locator

  // Pointer
  pointer: {
    tap(x: number, y: number, options?: TapOptions): Promise<void>
    doubleTap(x: number, y: number, options?: TapOptions): Promise<void>
    longPress(x: number, y: number, options?: LongPressOptions): Promise<void>
    down(x: number, y: number, options?: PointerEventOptions): Promise<void>
    move(x: number, y: number, options?: MoveOptions): Promise<void>
    up(options?: PointerEventOptions): Promise<void>
    drag(from: Point, to: Point, options?: DragOptions): Promise<void>
    swipe(options: SwipeOptions): Promise<void>
    dragPath(points: Point[], options?: DragPathOptions): Promise<void>
    movePath(points: Point[], options?: MovePathOptions): Promise<void>
    gesture(): GestureBuilder
    pinch(options: PinchOptions): Promise<void>
    rotate(options: RotateOptions): Promise<void>
    multiGesture(): MultiGestureBuilder
  }

  // Screenshots
  screenshot(options?): Promise<Buffer>

  // Lifecycle
  openURL(url: string): Promise<void>
  reload(): Promise<void>
  background(): Promise<void>
  foreground(): Promise<void>

  // Capabilities
  capabilities(): Promise<Capabilities>

  // Platform
  readonly platform: 'ios' | 'android'
}
```

### Locator Interface

The `Locator` interface is stable:

```typescript
interface Locator {
  tap(): Promise<void>
  type(text: string): Promise<void>
  waitFor(options?: WaitForOptions): Promise<void>
  isVisible(): Promise<boolean>
  bounds(): Promise<ElementBounds | null>
  screenshot(): Promise<Buffer>
}
```

### Types

These types are stable:

- `Device`, `Locator`
- `DeviceOptions`, `ElementBounds`, `DragOptions`, `DragPathOptions`, `MovePathOptions`
- `WaitForOptions`, `WaitForState`
- `Capabilities`, `HarnessLoadMode`

### Touch Backend Configuration

Touch backend names and the `TouchBackendConfig` shape are currently stable enough for app/test configuration, with one important behavior note: `auto` mode defaults to `native-module` only on both iOS and Android. XCTest and Instrumentation companions are available only when explicitly selected with `touch.order` or `mode: "force"`.

### Errors

These error classes are stable:

- `TimeoutError`
- `LocatorError`
- `HarnessNotInstalledError`

## Experimental API

### CDP Client

The `CDPClient` class is experimental. Auto-reconnect options may change:

```typescript
// Experimental - may change in minor versions
interface CDPClientOptions {
  timeout?: number
  autoReconnect?: boolean // Experimental
  maxReconnectAttempts?: number // Experimental
  reconnectBackoffMs?: number // Experimental
}
```

### Harness Dev Entry

The `/harness/dev` entry point is experimental:

```typescript
// Experimental - guard conditions may change
import '@0xbigboss/rn-playwright-driver/harness/dev'
```

### Companion Backends

The `xctest` and `instrumentation` touch backends are experimental. Their driver-side clients are implemented, but companion packaging and automatic lifecycle management are not part of the stable release surface yet.

### CLI Touch Backend

The `cli` backend type is experimental and currently a stub. It should not be used as a production fallback until idb/adb command execution is implemented and covered by device-backed tests.

## Internal API

### Harness Internals

Everything under `globalThis.__RN_DRIVER__._internal` is internal:

```typescript
// INTERNAL - do not use
globalThis.__RN_DRIVER__._internal.handlers
globalThis.__RN_DRIVER__._internal.lastPosition
globalThis.__RN_DRIVER__._internal.isDown
```

### Native Module Bridges

Direct access to native bridges should use the harness API:

```typescript
// Use this (stable)
await device.getByTestId('button').tap()

// Not this (internal)
globalThis.__RN_DRIVER__.viewTree.findByTestId('button')
```

### LocatorImpl Class

The `LocatorImpl` class is internal. Use `createLocator`:

```typescript
// Use this
import { createLocator } from '@0xbigboss/rn-playwright-driver'
const locator = createLocator(device, { type: 'testId', value: 'button' })

// Not this
import { LocatorImpl } from '@0xbigboss/rn-playwright-driver'
const locator = new LocatorImpl(device, selector)
```

## Upgrade Notes

### v0.1.x → v0.2.x (Future)

Planned changes:

- `waitFor()` options may expand to include `strict` mode
- CDP auto-reconnect may become stable
- Native module naming may be finalized

### Breaking Change Policy

1. **Major versions** (1.0, 2.0): May contain breaking changes
2. **Minor versions** (0.1, 0.2): May break experimental APIs
3. **Patch versions** (0.1.1): Bug fixes only

### Deprecation Process

1. Feature is marked deprecated in documentation
2. Console warning added (in dev mode only)
3. Feature removed in next major version

## Feature Requests

For new features or API changes, please open an issue on GitHub. We prioritize stability and only add features that align with the Playwright API model.
