/**
 * Window metrics for layout assertions and coordinate calculations.
 * All dimensions are in logical points (not physical pixels).
 */
export type WindowMetrics = {
  /** Screen width in logical points */
  width: number
  /** Screen height in logical points */
  height: number
  /** Device pixel ratio */
  pixelRatio: number
  /** Alias for pixelRatio (matches RN PixelRatio.get()) */
  scale: number
  /** Font scale factor (for accessibility) */
  fontScale: number
  /** Current screen orientation */
  orientation: 'portrait' | 'landscape'
  /** Safe area insets (if available via react-native-safe-area-context or similar) */
  safeAreaInsets?: { top: number; right: number; bottom: number; left: number }
}

/**
 * Driver event types for tracing.
 */
export type DriverEventType =
  | 'pointer:down'
  | 'pointer:move'
  | 'pointer:up'
  | 'pointer:tap'
  | 'locator:find'
  | 'locator:tap'
  | 'evaluate'
  | 'console'
  | 'error'

/**
 * A traced event from the driver.
 */
export type DriverEvent = {
  /** Event type */
  type: DriverEventType
  /** Timestamp when event occurred */
  timestamp: number
} & ({ /** Event-specific data */ data: Record<string, unknown> } | { data?: undefined })

/**
 * Tracing options.
 */
export type TracingOptions = {
  /** Include console logs in trace (default: false) */
  includeConsole?: boolean
}

/**
 * App lifecycle states.
 */
export type AppState = 'active' | 'background' | 'inactive'

/**
 * Capability flags for feature detection.
 */
export type Capabilities = {
  /** Harness API version for capability negotiation */
  apiVersion: number
  viewTree: boolean
  viewTreeTap: boolean
  screenshot: boolean
  screenshotCaptureElement: boolean
  lifecycle: boolean
  touchNative: boolean
}
