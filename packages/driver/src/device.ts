import { CDPClient, type CDPClientOptions } from './cdp/client'
import { discoverTargets, selectTarget } from './cdp/discovery'
import { parseConsoleEvent, parseExceptionEvent } from './cdp/runtime-events'
import { buildCapabilitiesExpression, buildHarnessCall } from './harness-expressions'
import type { Locator } from './locator'
import { buildRoleSelector, createLocator, LocatorError } from './locator'
import { Pointer } from './pointer'
import { computeScrollGesture } from './scroll'
import { createTouchBackend, type TouchBackend } from './touch'
import { waitForStable, type WaitForStableOptions } from './wait-for-stable'
import type {
  Capabilities,
  Device,
  DeviceEventMap,
  DeviceOptions,
  DriverEvent,
  ElementBounds,
  PageError,
  ScrollOptions,
  TouchBackendInfo,
  TracingOptions,
  WindowMetrics,
} from './types'

const DEFAULT_METRO_URL = 'http://localhost:8081'
const DEFAULT_WAIT_TIMEOUT = 30_000
const DEFAULT_POLLING_INTERVAL = 100

/**
 * Error thrown when an operation times out.
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

/**
 * Error a device operation rejects with when `failOnUncaughtException` is set and
 * an uncaught app exception was captured before the operation ran. Carries the
 * original {@link PageError} for inspection.
 */
export class UncaughtExceptionError extends Error {
  readonly pageError: PageError

  constructor(pageError: PageError) {
    super(`Uncaught exception in app: ${pageError.message}`)
    this.name = 'UncaughtExceptionError'
    this.pageError = pageError
  }
}

/**
 * Result type from native module calls.
 */
type NativeResult<T> = { success: true; data: T } | { success: false; error: string; code: string }

export type RNDeviceOptions = DeviceOptions & CDPClientOptions

/**
 * React Native device implementation using CDP.
 */
export class RNDevice implements Device {
  private readonly options: RNDeviceOptions
  private readonly cdp: CDPClient
  private readonly _pointer: Pointer
  private _touchBackend: TouchBackend | null = null
  private _touchBackendInfo: TouchBackendInfo | null = null
  private _platform: 'ios' | 'android' = 'ios'
  // Runtime-event listeners, keyed by event name. Function identity is the
  // unsubscribe key; payloads are cast at the typed on()/emit() boundary.
  private readonly _listeners = new Map<string, Set<(payload: unknown) => void>>()
  // Uncaught app exceptions captured since the last failOnUncaughtException check.
  private readonly _uncaughtExceptions: PageError[] = []
  // Teardown for the CDP event forwarders registered in connect().
  private _eventForwarderCleanups: Array<() => void> = []

  constructor(options: RNDeviceOptions = {}) {
    const timeout = options.timeout ?? DEFAULT_WAIT_TIMEOUT
    this.options = {
      metroUrl: options.metroUrl ?? DEFAULT_METRO_URL,
      timeout,
      ...options,
    }
    this.cdp = new CDPClient({ timeout })
    this._pointer = new Pointer(null, this)
  }

  // --- Connection ---

  async connect(): Promise<void> {
    const metroUrl = this.options.metroUrl ?? DEFAULT_METRO_URL
    const targets = await discoverTargets(metroUrl)
    const target = selectTarget(targets, this.options)

    await this.cdp.connect(target.webSocketDebuggerUrl)

    // Forward console + exception events now that Runtime is enabled.
    this.registerRuntimeEventForwarders()

    // Detect platform from target info or via JS
    this._platform = await this.detectPlatform(target)

    const { backend, selection } = await createTouchBackend(
      {
        platform: this._platform,
        evaluate: this.evaluate.bind(this),
        waitForTimeout: this.waitForTimeout.bind(this),
      },
      this.options.touch,
    )
    this._touchBackend = backend
    const backendInfo: TouchBackendInfo = {
      selected: selection.backend,
      available: selection.available,
    }
    if (selection.reason !== undefined) {
      backendInfo.reason = selection.reason
    }
    this._touchBackendInfo = backendInfo
    this._pointer.setBackend(backend)
  }

  async disconnect(): Promise<void> {
    for (const cleanup of this._eventForwarderCleanups) {
      cleanup()
    }
    this._eventForwarderCleanups = []
    // Drop buffered exceptions so a stale one can't poison a later reconnect of
    // this same device instance.
    this._uncaughtExceptions.length = 0
    if (this._touchBackend) {
      await this._touchBackend.dispose()
      this._touchBackend = null
    }
    await this.cdp.disconnect()
  }

  async ping(): Promise<boolean> {
    return this.cdp.ping()
  }

  // --- Runtime events (console + uncaught exceptions) ---

  on<E extends keyof DeviceEventMap>(
    event: E,
    listener: (payload: DeviceEventMap[E]) => void,
  ): () => void {
    let set = this._listeners.get(event)
    if (!set) {
      set = new Set()
      this._listeners.set(event, set)
    }
    set.add(listener as (payload: unknown) => void)
    return () => this.off(event, listener)
  }

  off<E extends keyof DeviceEventMap>(
    event: E,
    listener: (payload: DeviceEventMap[E]) => void,
  ): void {
    this._listeners.get(event)?.delete(listener as (payload: unknown) => void)
  }

  private emit<E extends keyof DeviceEventMap>(event: E, payload: DeviceEventMap[E]): void {
    const set = this._listeners.get(event)
    if (!set) {
      return
    }
    for (const listener of set) {
      try {
        listener(payload)
      } catch (err) {
        console.error(`Device: "${event}" listener threw:`, err)
      }
    }
  }

  /**
   * Forward CDP runtime events to device listeners. Called once per connection;
   * the returned CDP unsubscribers are torn down on disconnect.
   */
  private registerRuntimeEventForwarders(): void {
    this._eventForwarderCleanups.push(
      this.cdp.onEvent('Runtime.consoleAPICalled', (params) => {
        // Console has no internal buffer (unlike exceptions) — if nobody is
        // listening there is no consumer, so skip the per-event arg-mapping parse
        // for noisy app logs.
        if (!this._listeners.get('console')?.size) {
          return
        }
        this.emit('console', parseConsoleEvent(params))
      }),
      this.cdp.onEvent('Runtime.exceptionThrown', (params) => {
        const error = parseExceptionEvent(params)
        // Only buffer when failOnUncaughtException will consume it; otherwise the
        // buffer is never drained (throwIfUncaughtException returns early) and
        // grows unbounded for the lifetime of the connection. Listeners still get
        // every exception via the unconditional emit below.
        if (this.options.failOnUncaughtException) {
          this._uncaughtExceptions.push(error)
        }
        this.emit('pageerror', error)
      }),
    )
  }

  /**
   * If failOnUncaughtException is enabled and an app exception was captured,
   * throw the oldest one (removing it) so the failing operation reports it.
   */
  private throwIfUncaughtException(): void {
    if (!this.options.failOnUncaughtException) {
      return
    }
    const first = this._uncaughtExceptions.shift()
    if (first) {
      throw new UncaughtExceptionError(first)
    }
  }

  // --- JS Evaluation (Phase 1) ---

  async evaluate<T>(expression: string): Promise<T> {
    this.throwIfUncaughtException()
    const result = await this.cdp.evaluate<T>(expression)
    // Trace the evaluate call if tracing is active
    // We do this after the call to avoid tracing internal startTracing/stopTracing calls
    if (!expression.includes('startTracing') && !expression.includes('stopTracing')) {
      try {
        await this.cdp.evaluate(
          `globalThis.__RN_DRIVER__?.traceEvent?.("evaluate", { expression: ${JSON.stringify(expression.slice(0, 200))} })`,
        )
      } catch {
        // Ignore errors from tracing injection
      }
    }
    return result
  }

  // --- Locators (Phase 3) ---

  getByTestId(testId: string): Locator {
    return createLocator(this, { type: 'testId', value: testId })
  }

  getByText(text: string, options?: { exact?: boolean }): Locator {
    return createLocator(this, {
      type: 'text',
      value: text,
      exact: options?.exact ?? false,
    })
  }

  getByRole(role: string, options?: { name?: string }): Locator {
    return createLocator(this, buildRoleSelector(role, options))
  }

  // --- Pointer/Touch (Phase 2) ---

  get pointer(): Pointer {
    return this._pointer
  }

  /**
   * Scroll content by a delta via a single swipe gesture (no element target).
   * Geometry is resolved by the pure {@link computeScrollGesture}; this only
   * wires window metrics to the pointer backend.
   */
  async scroll(options: ScrollOptions): Promise<void> {
    const metrics = await this.getWindowMetrics()
    await this._pointer.swipe(computeScrollGesture(metrics, options))
  }

  // --- Screenshots (Phase 3) ---

  async screenshot(options?: { clip?: ElementBounds }): Promise<Buffer> {
    let result: NativeResult<string>

    if (options?.clip) {
      // Capture specific region
      const { x, y, width, height } = options.clip
      result = await this.evaluate<NativeResult<string>>(
        buildHarnessCall(
          'screenshot.captureRegion',
          `{ x: ${x}, y: ${y}, width: ${width}, height: ${height} }`,
        ),
      )
    } else {
      // Capture full screen
      result = await this.evaluate<NativeResult<string>>(
        buildHarnessCall('screenshot.captureScreen'),
      )
    }

    if (!result.success) {
      throw new LocatorError(result.error, result.code)
    }

    // Decode base64 to Buffer
    return Buffer.from(result.data, 'base64')
  }

  // --- Navigation/Lifecycle (Phase 3) ---

  async openURL(url: string): Promise<void> {
    const result = await this.evaluate<NativeResult<void>>(
      buildHarnessCall('lifecycle.openURL', JSON.stringify(url)),
    )

    if (!result.success) {
      throw new LocatorError(result.error, result.code)
    }
  }

  async reload(): Promise<void> {
    const result = await this.evaluate<NativeResult<void>>(buildHarnessCall('lifecycle.reload'))

    if (!result.success) {
      throw new LocatorError(result.error, result.code)
    }
  }

  async background(): Promise<void> {
    const result = await this.evaluate<NativeResult<void>>(buildHarnessCall('lifecycle.background'))

    if (!result.success) {
      throw new LocatorError(result.error, result.code)
    }
  }

  async foreground(): Promise<void> {
    const result = await this.evaluate<NativeResult<void>>(buildHarnessCall('lifecycle.foreground'))

    if (!result.success) {
      throw new LocatorError(result.error, result.code)
    }
  }

  // --- Capabilities Detection ---

  async capabilities(): Promise<Capabilities> {
    return this.evaluate<Capabilities>(buildCapabilitiesExpression())
  }

  // --- Utilities (Phase 1) ---

  async waitForTimeout(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async waitForFunction<T>(
    expression: string,
    options?: { timeout?: number; polling?: number },
  ): Promise<T> {
    const timeout = options?.timeout ?? this.options.timeout ?? DEFAULT_WAIT_TIMEOUT
    const polling = options?.polling ?? DEFAULT_POLLING_INTERVAL
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      const result = await this.evaluate<T>(expression)
      if (result) {
        return result
      }
      await this.waitForTimeout(polling)
    }

    throw new TimeoutError(
      `waitForFunction timed out after ${timeout}ms: ${expression.slice(0, 100)}...`,
    )
  }

  // --- Core Primitives ---

  async getWindowMetrics(): Promise<WindowMetrics> {
    return this.evaluate<WindowMetrics>(buildHarnessCall('getWindowMetrics'))
  }

  async getFrameCount(): Promise<number> {
    return this.evaluate<number>(buildHarnessCall('getFrameCount'))
  }

  async waitForRaf(count: number = 1): Promise<void> {
    const startFrame = await this.getFrameCount()
    const targetFrame = startFrame + count
    await this.waitForFrameCount(targetFrame)
  }

  async waitForFrameCount(target: number): Promise<void> {
    const timeout = this.options.timeout ?? DEFAULT_WAIT_TIMEOUT
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      const current = await this.getFrameCount()
      if (current >= target) {
        return
      }
      // Use a short polling interval since RAF fires at ~16ms (60fps)
      await this.waitForTimeout(8)
    }

    throw new TimeoutError(`waitForFrameCount(${target}) timed out after ${timeout}ms`)
  }

  async waitForStable<T>(
    sample: () => Promise<T | undefined>,
    options?: WaitForStableOptions<T>,
  ): Promise<void> {
    // `this` supplies waitForTimeout (the WaitForStableTimer dependency).
    await waitForStable(sample, this, options)
  }

  async getTouchBackendInfo(): Promise<TouchBackendInfo> {
    if (!this._touchBackendInfo) {
      throw new Error('Device not connected. Call connect() first.')
    }
    return this._touchBackendInfo
  }

  async startTracing(options?: TracingOptions): Promise<void> {
    const optionsJson = JSON.stringify(options ?? {})
    await this.evaluate(buildHarnessCall('startTracing', optionsJson))
  }

  async stopTracing(): Promise<{ events: DriverEvent[] }> {
    return this.evaluate<{ events: DriverEvent[] }>(buildHarnessCall('stopTracing'))
  }

  // --- Platform Info ---

  get platform(): 'ios' | 'android' {
    return this._platform
  }

  // --- Private helpers ---

  private async detectPlatform(target: {
    deviceName?: string
    title?: string
  }): Promise<'ios' | 'android'> {
    // Try to detect from target metadata first
    const name = target.deviceName?.toLowerCase() ?? target.title?.toLowerCase() ?? ''
    if (name.includes('iphone') || name.includes('ipad') || name.includes('ios')) {
      return 'ios'
    }
    if (name.includes('android') || name.includes('pixel') || name.includes('samsung')) {
      return 'android'
    }

    // Fall back to JS detection
    try {
      const platform = await this.evaluate<string>("require('react-native').Platform.OS")
      if (platform === 'ios' || platform === 'android') {
        return platform
      }
    } catch {
      // Ignore evaluation errors
    }

    // Default to iOS
    return 'ios'
  }
}

/**
 * Create a device instance with the given options.
 */
export function createDevice(options?: RNDeviceOptions): RNDevice {
  return new RNDevice(options)
}
