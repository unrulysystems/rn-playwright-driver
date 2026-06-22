// Main entry point for @0xbigboss/rn-playwright-driver

export type { CDPClientOptions } from './cdp/client'
// --- CDP (advanced usage) ---
export { CDPClient } from './cdp/client'
export type { DebugTarget, TargetSelectionOptions } from './cdp/discovery'
export { discoverTargets, selectTarget } from './cdp/discovery'
export type { RNDeviceOptions } from './device'
// --- Device ---
export { createDevice, RNDevice, TimeoutError, UncaughtExceptionError } from './device'
// --- Assertions ---
export type {
  AssertionOptions,
  LocatorAssertions,
  SnapshotOptions,
  TextAssertionOptions,
} from './expect'
export { AssertionError, expect } from './expect'
export type { Locator as LocatorType, LocatorSelector } from './locator'
// --- Locator ---
export { createLocator, LocatorError, LocatorImpl } from './locator'
// --- Pointer ---
export { Pointer } from './pointer'
// --- Stabilization primitive ---
export type { WaitForStableOptions, WaitForStableTimer } from './wait-for-stable'
export { waitForStable } from './wait-for-stable'
export type { TouchBackend, TouchBackendContext, TouchBackendSelection } from './touch'
export {
  CliTouchBackend,
  createTouchBackend,
  InstrumentationTouchBackend,
  NativeModuleTouchBackend,
  TouchBackendCommandError,
  TouchBackendError,
  TouchBackendNotInitializedError,
  TouchBackendUnavailableError,
  XCTestTouchBackend,
} from './touch'
// --- Types ---
export type {
  Capabilities,
  ConsoleMessage,
  Device,
  DeviceEventMap,
  DeviceOptions,
  DragOptions,
  DragPathOptions,
  DriverEvent,
  DriverEventType,
  Easing,
  ElementBounds,
  GestureBuilder,
  HarnessLoadMode,
  InterpolationOptions,
  Locator,
  LongPressOptions,
  MoveOptions,
  MovePathOptions,
  MultiGestureBuilder,
  PageError,
  PinchOptions,
  PlannedPointerEvent,
  Point,
  PointerEventOptions,
  RotateOptions,
  ScrollIntoViewOptions,
  ScrollOptions,
  SwipeOptions,
  TapOptions,
  TimingOptions,
  TouchBackendConfig,
  TouchBackendInfo,
  TouchBackendMode,
  TouchBackendType,
  TracingOptions,
  WaitForOptions,
  WaitForState,
  WindowMetrics,
} from './types'
