import { CDPClient, type CDPClientOptions } from './cdp/client'
import { discoverTargets, selectTargetForConnect, titleParenthetical } from './cdp/discovery'
import { parseConsoleEvent, parseExceptionEvent } from './cdp/runtime-events'
import { createDeviceFiles } from './files/device-files'
import { FileIoError } from './files/errors'
import { createDefaultTransportFactory } from './files/transports'
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
  DeviceFiles,
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
  // Host-side file I/O, built in connect() once the platform is known. Null until
  // connected — the `files` getter throws a clear error before then.
  private _files: DeviceFiles | null = null
  // Per-connection liveness token for device.files; flipped on disconnect so a
  // captured reference fails closed (host-side file I/O outlives the CDP socket).
  private _filesLifecycle: { connected: boolean } | null = null
  // Runtime-event listeners, keyed by event name. Function identity is the
  // unsubscribe key; payloads are cast at the typed on()/emit() boundary.
  private readonly _listeners = new Map<string, Set<(payload: unknown) => void>>()
  // Uncaught app exceptions captured since the last failOnUncaughtException check.
  // Bounded: throwIfUncaughtException drains one per operation, so an exception
  // storm between operations would otherwise grow without limit. We keep the
  // OLDEST (FIFO — the first failure is the most diagnostic) and drop newer ones
  // once full.
  private readonly _uncaughtExceptions: PageError[] = []
  private static readonly MAX_BUFFERED_EXCEPTIONS = 64
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
    // selectTargetForConnect derives the file-pin from target.udid/serial and
    // fails closed on the device.files confused-deputy (a pinned file target but
    // ambiguous CDP selection among multiple runtimes).
    const target = selectTargetForConnect(targets, this.options)

    // Register the console + exception forwarders BEFORE connecting. cdp.connect()
    // sends Runtime.enable internally, after which the runtime starts emitting
    // events; subscribing afterwards drops anything fired in that window (a console
    // log or an uncaught exception). onEvent only populates a handler map — no
    // socket required — so registering first is always safe and closes the gap.
    this.registerRuntimeEventForwarders()

    await this.cdp.connect(target.webSocketDebuggerUrl)

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

    // Host-side file I/O. Targeting is validated lazily (per op) so a device
    // without file targeting only fails when device.files is actually used.
    // A per-connection lifecycle token ties file I/O to this connection: a
    // reference captured before disconnect() fails closed afterwards, and a later
    // reconnect gets a fresh token so the stale object stays disposed. Invalidate any
    // prior token FIRST: a second connect() without an intervening disconnect() would
    // otherwise orphan the old token (still `connected`) and leave an older captured
    // device.files live past the next disconnect (which only flips the newest token).
    if (this._filesLifecycle) {
      this._filesLifecycle.connected = false
    }
    const filesLifecycle = { connected: true }
    this._filesLifecycle = filesLifecycle
    this._files = createDeviceFiles({
      platform: this._platform,
      target: this.options.target,
      // Bound host file ops by the device timeout so a hung CLI can't stall them.
      selectTransport: createDefaultTransportFactory(this.options.timeout),
      isLive: () => filesLifecycle.connected,
    })
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
    this._touchBackendInfo = null
    // Dispose the file-I/O lifecycle token so any captured `device.files` reference
    // fails closed after disconnect (host-side I/O would otherwise keep working).
    if (this._filesLifecycle) {
      this._filesLifecycle.connected = false
      this._filesLifecycle = null
    }
    this._files = null
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
    // Idempotent: the forwarders persist on the CDP client across reconnects, so a
    // re-entrant connect() (e.g. a retry after a failed attempt registered them but
    // never disconnected) must not double-subscribe. disconnect() clears the list,
    // so the next connect() re-registers cleanly.
    if (this._eventForwarderCleanups.length > 0) {
      return
    }
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
        // buffer is never drained (throwIfUncaughtException returns early). Even
        // when enabled, cap the buffer so an exception storm between operations
        // cannot grow memory without bound — keep the oldest (first failure is the
        // most diagnostic), drop the overflow. Listeners still get every exception
        // via the unconditional emit below.
        if (
          this.options.failOnUncaughtException &&
          this._uncaughtExceptions.length < RNDevice.MAX_BUFFERED_EXCEPTIONS
        ) {
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

  // --- Device file I/O ---

  get files(): DeviceFiles {
    if (!this._files) {
      throw new FileIoError('UNAVAILABLE', 'device.files is available after connect()')
    }
    return this._files
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
    // Try to detect from target metadata first, reading the DEVICE identity, not
    // an app id. A Metro title is often `appId (deviceName)`; matching the full
    // string lets an app id containing `ios` (e.g. `com.acme.iosapp (Pixel_8)`)
    // misclassify an Android runtime as iOS and route touch + device.files through
    // the wrong platform. Prefer the deviceName field; else the title's trailing
    // `(…)` (the device, NOT the app id ahead of it); else — a bare title with no
    // parenthetical is itself the device name, so fall back to it. Anything
    // unmatched drops to the authoritative Platform.OS probe below.
    const name = (
      target.deviceName ??
      titleParenthetical(target.title) ??
      target.title ??
      ''
    ).toLowerCase()
    if (name.includes('iphone') || name.includes('ipad') || name.includes('ios')) {
      return 'ios'
    }
    if (
      name.includes('android') ||
      name.includes('pixel') ||
      name.includes('samsung') ||
      name.includes('gphone')
    ) {
      return 'android'
    }

    // Fall back to the app runtime as the authoritative source. If the probe
    // cannot produce a supported RN platform, fail loudly so Android never
    // accidentally takes the iOS backend path.
    try {
      const platform = await this.evaluate<unknown>(
        "(() => { const { Platform } = require('react-native'); return Platform?.OS })()",
      )
      if (platform === 'ios' || platform === 'android') {
        return platform
      }
    } catch (error) {
      throw new Error(
        `Could not detect platform: CDP target name unrecognized and Platform.OS probe failed (${error instanceof Error ? error.message : String(error)})`,
        { cause: error },
      )
    }

    throw new Error(
      'Could not detect platform: CDP target name unrecognized and Platform.OS probe returned an unsupported value',
    )
  }
}

/**
 * Create a device instance with the given options.
 */
export function createDevice(options?: RNDeviceOptions): RNDevice {
  return new RNDevice(options)
}
