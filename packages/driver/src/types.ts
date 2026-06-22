import type { ElementBounds } from '@0xbigboss/rn-driver-shared-types'
import type {
  Capabilities,
  DriverEvent,
  TracingOptions,
  WindowMetrics,
} from '../harness/shared-types'
import type { TargetSelectionOptions } from './cdp/discovery'
import type { WaitForStableOptions } from './wait-for-stable'

export type { ElementBounds } from '@0xbigboss/rn-driver-shared-types'
export type {
  Capabilities,
  DriverEvent,
  DriverEventType,
  TracingOptions,
  WindowMetrics,
} from '../harness/shared-types'

export type DeviceOptions = {
  /** Metro bundler URL (default: 'http://localhost:8081') */
  metroUrl?: string
  /** Touch backend selection and config */
  touch?: TouchBackendConfig
  /**
   * When true, an uncaught JS exception in the app (CDP `Runtime.exceptionThrown`)
   * makes the next JS-evaluating device operation reject with an
   * `UncaughtExceptionError` — i.e. `evaluate()` and anything built on it (locator
   * queries, `waitForFunction`, frame waits). Pure-timing ops (`waitForTimeout`,
   * `ping`) do not gate on it. Off by default — exceptions are always delivered
   * via `device.on("pageerror")` regardless.
   */
  failOnUncaughtException?: boolean
} & TargetSelectionOptions

// --- Runtime events (console + uncaught exceptions) ---

/**
 * A console call captured from the app runtime (CDP `Runtime.consoleAPICalled`).
 */
export interface ConsoleMessage {
  /** Console method: 'log' | 'warning' | 'error' | 'info' | 'debug' | 'dir' | ... */
  type: string
  /** Best-effort flattened text of the console arguments. */
  text: string
  /** Argument payloads, by value where the runtime serialized one (else undefined). */
  args: unknown[]
  /** Runtime timestamp in ms, when provided by CDP. */
  timestamp?: number
}

/**
 * An uncaught error captured from the app runtime (CDP `Runtime.exceptionThrown`).
 */
export interface PageError {
  /** Error message / description (includes the stack on Hermes/V8). */
  message: string
  /** Stack trace text, when available. */
  stack?: string
  /** Runtime timestamp in ms, when provided by CDP. */
  timestamp?: number
}

/** Payload map for {@link Device.on} / {@link Device.off}. */
export interface DeviceEventMap {
  /** Fired for each `console.*` call in the app. */
  console: ConsoleMessage
  /** Fired for each uncaught JS exception in the app. */
  pageerror: PageError
}

// --- Wait states for Locator.waitFor ---

/** States for Locator.waitFor() */
export type WaitForState = 'attached' | 'visible' | 'hidden' | 'detached'

/** Options for Locator.waitFor() */
export interface WaitForOptions {
  /** Target state to wait for (default: "visible") */
  state?: WaitForState
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number
}

// --- Capabilities detection ---

// --- Harness loading modes ---

/** How to load the test harness in the app */
export type HarnessLoadMode = 'always' | 'dev-only' | 'explicit'

export type Point = {
  /** X position in logical points (not pixels) */
  x: number
  /** Y position in logical points */
  y: number
}

export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | ((t: number) => number)

export type PointerEventOptions = {
  /** Pointer ID for multi-touch (default: 0) */
  pointerId?: number
  /** Pressure 0-1 for pressure-sensitive input (default: 1) */
  pressure?: number
}

export type MoveOptions = PointerEventOptions & {
  /** Number of intermediate move events (default: 1 = direct) */
  steps?: number
}

export type TimingOptions = {
  /** Pause after pointer down, before movement (default: 16ms) */
  holdStart?: number
  /** Pause after movement, before pointer up (default: 16ms) */
  holdEnd?: number
}

export type InterpolationOptions = {
  /** Duration-based: total gesture time in ms (takes precedence over steps) */
  duration?: number
  /** Step-based: number of move events (ignored if duration is set) */
  steps?: number
  /** Easing function (default: 'linear' for drag, 'ease-out' for swipe) */
  easing?: Easing
}

export type TapOptions = {
  /** Pause between down and up (default: 16ms) */
  holdStart?: number
  /** Number of taps (default: 1) */
  count?: number
  /** Delay between taps for multi-tap (default: 100ms) */
  tapDelay?: number
}

export type DragOptions = TimingOptions & InterpolationOptions

export type LongPressOptions = TimingOptions & {
  /** Hold duration in ms (default: 500ms) */
  duration?: number
}

/** Options for swipe gesture */
export type SwipeOptions = TimingOptions &
  InterpolationOptions & {
    /** Starting point */
    from: Point
    /** Ending point */
    to: Point
  }

/**
 * Options for {@link Device.scroll} — a content-delta scroll performed as a
 * single swipe gesture.
 *
 * Sign convention matches the web `scrollBy`: a positive delta reveals later
 * content (the finger drags the opposite way).
 * - `dy > 0` scrolls DOWN (reveals content below the fold).
 * - `dy < 0` scrolls UP.
 * - `dx > 0` scrolls RIGHT, `dx < 0` scrolls LEFT.
 *
 * The gesture is anchored at the viewport center unless `x`/`y` are given, and
 * is clamped to a mid-screen safe band, so the effective scroll magnitude is
 * bounded by the available on-screen swipe distance.
 */
export type ScrollOptions = TimingOptions &
  InterpolationOptions & {
    /** Horizontal content delta in logical points (default: 0). */
    dx?: number
    /** Vertical content delta in logical points (default: 0). */
    dy?: number
    /**
     * Swipe anchor X in logical points (default: viewport center). Clamped to
     * the mid-screen safe band, so an out-of-band value is moved to the nearest
     * band edge.
     */
    x?: number
    /**
     * Swipe anchor Y in logical points (default: viewport center). Clamped to
     * the mid-screen safe band, so an out-of-band value is moved to the nearest
     * band edge.
     */
    y?: number
  }

/**
 * Options for {@link Locator.scrollIntoView}.
 */
export type ScrollIntoViewOptions = {
  /** Maximum number of scroll gestures to attempt (default: 10). */
  maxScrolls?: number
  /**
   * Minimum gap in logical points to keep between the element and each viewport
   * edge once it is considered "in view" (default: 0).
   */
  margin?: number
  /**
   * Direction to scroll when the element is not currently in the view tree
   * (e.g. virtualized off-screen content), so its position can't be measured to
   * infer direction. Ignored once the element is found (direction is then
   * derived from its bounds). Default: "down".
   */
  direction?: 'up' | 'down' | 'left' | 'right'
}

export type TouchBackendType = 'xctest' | 'instrumentation' | 'native-module' | 'cli'

// --- Touch Backend Info ---

/**
 * Information about the selected touch backend.
 */
export type TouchBackendInfo = {
  /** Currently selected backend */
  selected: TouchBackendType
  /** All available backends */
  available: TouchBackendType[]
  /** Reason for backend selection (for diagnostics) */
  reason?: string
}

// --- Tracing ---

// --- Pointer Path Options ---

/**
 * Options for drag path operations (dragPath).
 */
export type DragPathOptions = TimingOptions & {
  /** Delay between each point in ms (default: 0) */
  delay?: number
}

/**
 * Options for move path operations (movePath).
 */
export type MovePathOptions = {
  /** Delay between each point in ms (default: 0) */
  delay?: number
}

export type PlannedPointerEvent = {
  type: 'down' | 'move' | 'up' | 'wait'
  x?: number
  y?: number
  ms?: number
  pointerId?: number
  pressure?: number
}

export interface GestureBuilder {
  // Pointer state
  down(x: number, y: number, options?: PointerEventOptions): this
  up(options?: PointerEventOptions): this

  // Movement
  moveTo(x: number, y: number, options?: InterpolationOptions): this
  moveBy(dx: number, dy: number, options?: InterpolationOptions): this

  // Timing
  wait(ms: number): this
  /** Wait for N animation frames (~16ms per frame at 60fps) */
  waitFrames(count: number): this

  // Path helpers
  arc(
    center: Point,
    radius: number,
    startAngle: number,
    endAngle: number,
    options?: InterpolationOptions,
  ): this

  bezier(control1: Point, control2: Point, end: Point, options?: InterpolationOptions): this

  // Execution
  execute(): Promise<void>

  // Debug: inspect planned events without executing
  toEvents(): PlannedPointerEvent[]
}

export type PinchOptions = TimingOptions &
  InterpolationOptions & {
    center: Point
    startDistance: number
    endDistance: number
  }

export type RotateOptions = TimingOptions &
  InterpolationOptions & {
    center: Point
    distance: number
    startAngle: number
    endAngle: number
  }

export interface MultiGestureBuilder {
  /**
   * Get or create a gesture builder for a specific pointer ID.
   * All events added to the returned builder are tagged with this pointer ID.
   */
  pointer(id: number): GestureBuilder

  /**
   * Execute all pointer sequences in parallel.
   */
  execute(): Promise<void>
}

export type TouchBackendMode = 'auto' | 'force'

export type TouchBackendConfig = {
  /** Selection mode (default: "auto") */
  mode?: TouchBackendMode
  /** Force a specific backend when mode === "force" */
  backend?: TouchBackendType
  /** Ordered backend preference when mode === "auto" */
  order?: TouchBackendType[]
  /** XCTest companion connection options */
  xctest?: {
    enabled?: boolean
    host?: string
    port?: number
    connectTimeoutMs?: number
    requestTimeoutMs?: number
  }
  /** Android Instrumentation companion connection options */
  instrumentation?: {
    enabled?: boolean
    host?: string
    port?: number
    connectTimeoutMs?: number
    requestTimeoutMs?: number
  }
  /** Enable native-module backend (requires RNDriverTouchInjector / @0xbigboss/rn-driver-touch) */
  nativeModule?: {
    enabled?: boolean
  }
  /** Enable CLI backend (idb/adb) */
  cli?: {
    enabled?: boolean
  }
}

/**
 * Locator for finding and interacting with RN views.
 *
 * IMPORTANT: Most Locator methods require native modules (Phase 3).
 * In Phase 1-2, use device.pointer.* with coordinates from device.evaluate().
 *
 * Methods will throw descriptive errors if called before native modules are available.
 */
export type Locator = {
  /** Tap the element center. REQUIRES: RNDriverViewTree + RNDriverTouch (Phase 3) */
  tap(): Promise<void>
  /**
   * Type text into the element.
   * NOT YET IMPLEMENTED: Requires RNDriverKeyboard native module.
   * Use {@link Locator.fill} (no native module) or device.evaluate() as workaround.
   * @throws LocatorError with code "NOT_SUPPORTED"
   */
  type(text: string): Promise<void>
  /**
   * Set a text input's value in one shot. REPLACES the current value (it is not a
   * key-by-key append like a keyboard `type()`). Mirrors the value onto the native
   * view and fires a synthetic change so CONTROLLED inputs update React state (not
   * just setNativeProps). Auto-waits for the element to be actionable. No native
   * keyboard module required.
   *
   * @throws LocatorError "NOT_A_TEXT_INPUT" if the element is not a text input.
   * @throws LocatorError "NOT_SUPPORTED" if the harness cannot resolve the input.
   */
  fill(text: string): Promise<void>
  /**
   * Wait for element to reach a specific state.
   * - "attached": element exists in the view tree
   * - "visible": element exists AND is visible
   * - "hidden": element exists but is NOT visible
   * - "detached": element does NOT exist
   * REQUIRES: RNDriverViewTree (Phase 3)
   */
  waitFor(options?: WaitForOptions): Promise<void>
  /** Check if element exists and is visible. REQUIRES: RNDriverViewTree (Phase 3) */
  isVisible(): Promise<boolean>
  /** Get element bounds in logical points. REQUIRES: RNDriverViewTree (Phase 3) */
  bounds(): Promise<ElementBounds | null>
  /** Capture screenshot of element. REQUIRES: RNDriverScreenshot (Phase 3) */
  screenshot(): Promise<Buffer>
  /**
   * Scroll the element into the viewport.
   *
   * Repeatedly issues swipe gestures (via {@link Device.scroll}) on the
   * scrollable content until the element is fully on screen, bounded by
   * `maxScrolls`. Direction is inferred from the element's measured bounds when
   * it is in the view tree; for not-yet-rendered (e.g. virtualized) elements,
   * `options.direction` controls the blind scroll direction.
   *
   * REQUIRES: RNDriverViewTree (to measure) + a working touch backend.
   *
   * @throws LocatorError "TIMEOUT" if the scroll boundary is reached or
   * `maxScrolls` is exhausted before the element is fully visible, or
   * "NOT_FOUND" if the element never appears.
   */
  scrollIntoView(options?: ScrollIntoViewOptions): Promise<void>

  // --- Chaining methods ---
  /** Find element by testID within this element's subtree */
  getByTestId(testId: string): Locator
  /** Find element containing text within this element's subtree */
  getByText(text: string, options?: { exact?: boolean }): Locator
  /** Find element by accessibility role within this element's subtree */
  getByRole(role: string, options?: { name?: string }): Locator
  /** Return the nth matching element (0-indexed) */
  nth(index: number): Locator
  /** Return the first matching element */
  first(): Locator
  /** Return the last matching element */
  last(): Locator
}

/**
 * Coordinate system: All coordinates are in LOGICAL POINTS, not physical pixels.
 * Origin (0, 0) is top-left of the screen.
 * This matches RN's coordinate system and Playwright's default behavior.
 */
export interface Device {
  // --- Connection ---
  connect(): Promise<void>
  disconnect(): Promise<void>
  /** Health check - returns true if connection is alive */
  ping(): Promise<boolean>

  // --- Runtime events (console + uncaught exceptions) ---
  /**
   * Subscribe to a runtime event from the app. Returns an unsubscribe function.
   *
   * - `"console"`: each `console.*` call (CDP `Runtime.consoleAPICalled`)
   * - `"pageerror"`: each uncaught JS exception (CDP `Runtime.exceptionThrown`)
   *
   * Events are only delivered while connected; listeners registered before
   * `connect()` receive events from the connection onward.
   */
  on<E extends keyof DeviceEventMap>(
    event: E,
    listener: (payload: DeviceEventMap[E]) => void,
  ): () => void
  /** Remove a previously-registered runtime event listener. */
  off<E extends keyof DeviceEventMap>(
    event: E,
    listener: (payload: DeviceEventMap[E]) => void,
  ): void

  // --- JS Evaluation (Phase 1 - the foundation) ---
  /**
   * Evaluate JS expression in app context.
   * Expression must be a string; for complex logic, define functions in the app.
   */
  evaluate<T>(expression: string): Promise<T>

  // --- Locators (Phase 3 - require native modules) ---
  /**
   * Find element by testID prop.
   * Maps to accessibilityIdentifier on iOS, testID on Android.
   */
  getByTestId(testId: string): Locator
  /**
   * Find element containing text.
   * Searches accessibilityLabel and Text component children.
   */
  getByText(text: string, options?: { exact?: boolean }): Locator
  /**
   * Find element by accessibility role.
   * Maps to accessibilityRole prop.
   */
  getByRole(role: string, options?: { name?: string }): Locator

  // --- Pointer/Touch (Phase 2 - via touch backend) ---
  /**
   * Pointer coordinates are in LOGICAL POINTS, same as RN's coordinate system.
   */
  pointer: {
    /** Tap at coordinates (down + up) */
    tap(x: number, y: number, options?: TapOptions): Promise<void>
    /** Double-tap at coordinates */
    doubleTap(x: number, y: number, options?: TapOptions): Promise<void>
    /** Long press at coordinates */
    longPress(x: number, y: number, options?: LongPressOptions): Promise<void>
    /** Press down at coordinates */
    down(x: number, y: number, options?: PointerEventOptions): Promise<void>
    /** Move to coordinates (while pressed) */
    move(x: number, y: number, options?: MoveOptions): Promise<void>
    /** Release press */
    up(options?: PointerEventOptions): Promise<void>
    /** Drag from one point to another with interpolation */
    drag(
      from: { x: number; y: number },
      to: { x: number; y: number },
      options?: DragOptions,
    ): Promise<void>
    /** Swipe from one point to another with duration-based animation */
    swipe(options: SwipeOptions): Promise<void>
    /**
     * Execute a drag gesture along a path of points.
     * Performs down at first point, moves through all points, up at last point.
     */
    dragPath(points: { x: number; y: number }[], options?: DragPathOptions): Promise<void>
    /**
     * Move through a path of points without down/up.
     * Useful for hover effects or tracking gestures.
     */
    movePath(points: { x: number; y: number }[], options?: MovePathOptions): Promise<void>
    /** Create a gesture builder for complex sequences */
    gesture(): GestureBuilder
    /** Pinch gesture with two fingers */
    pinch(options: PinchOptions): Promise<void>
    /** Two-finger rotation gesture */
    rotate(options: RotateOptions): Promise<void>
    /** Multi-touch gesture builder */
    multiGesture(): MultiGestureBuilder
  }

  /**
   * Scroll the content by a delta via a single swipe gesture, without needing
   * an element target. Anchored at the viewport center by default.
   *
   * Sign convention matches web `scrollBy`: `dy > 0` reveals content below the
   * fold (scroll down), `dx > 0` reveals content to the right. See
   * {@link ScrollOptions}.
   */
  scroll(options: ScrollOptions): Promise<void>

  // --- Screenshots (Phase 3 - require native module) ---
  screenshot(options?: { clip?: ElementBounds }): Promise<Buffer>

  // --- Navigation/Lifecycle (Phase 3 - require native module) ---
  openURL(url: string): Promise<void>
  reload(): Promise<void>
  background(): Promise<void>
  foreground(): Promise<void>

  // --- Capabilities Detection ---
  /** Get available capabilities from the harness */
  capabilities(): Promise<Capabilities>

  // --- Utilities (Phase 1) ---
  waitForTimeout(ms: number): Promise<void>

  /**
   * Wait for a JS expression to return a truthy value.
   *
   * Semantics (matches Playwright):
   * - Polls the expression until it returns a truthy value
   * - Returns the truthy value (not just true)
   * - Throws TimeoutError if timeout expires
   * - If expression throws, the error propagates immediately (no retry)
   */
  waitForFunction<T>(
    expression: string,
    options?: { timeout?: number; polling?: number },
  ): Promise<T>

  // --- Core Primitives ---

  /**
   * Get current window metrics (dimensions, pixel ratio, orientation).
   * All values are in logical points.
   */
  getWindowMetrics(): Promise<WindowMetrics>

  /**
   * Get current RAF frame count from the harness.
   * Monotonically increasing counter incremented each requestAnimationFrame.
   */
  getFrameCount(): Promise<number>

  /**
   * Wait for N animation frames to elapse.
   * @param count Number of frames to wait (default: 1)
   */
  waitForRaf(count?: number): Promise<void>

  /**
   * Wait until the frame count reaches or exceeds the target value.
   * @param target Target frame count to wait for
   */
  waitForFrameCount(target: number): Promise<void>

  /**
   * Poll `sample` until two consecutive samples are equal (the value has settled)
   * or the timeout elapses. Bounded; resolves on stabilization or budget
   * exhaustion (never throws). The first poll waits before sampling, so call it
   * right after triggering motion (a scroll, a layout change).
   *
   * Return `undefined` from `sample` to stop immediately (e.g. the target is no
   * longer measurable). Pass `equals` for tolerant comparison of noisy values.
   */
  waitForStable<T>(
    sample: () => Promise<T | undefined>,
    options?: WaitForStableOptions<T>,
  ): Promise<void>

  /**
   * Get information about the currently selected touch backend.
   */
  getTouchBackendInfo(): Promise<TouchBackendInfo>

  /**
   * Start tracing driver events.
   * Events are stored in a bounded ring buffer on the device.
   */
  startTracing(options?: TracingOptions): Promise<void>

  /**
   * Stop tracing and return collected events.
   * Clears the trace buffer.
   */
  stopTracing(): Promise<{ events: DriverEvent[] }>

  // --- Platform Info ---
  readonly platform: 'ios' | 'android'
}
