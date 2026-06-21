import { CDPClient, type CDPClientOptions } from "./cdp/client";
import { discoverTargets, selectTarget } from "./cdp/discovery";
import { buildCapabilitiesExpression, buildHarnessCall } from "./harness-expressions";
import type { Locator } from "./locator";
import { buildRoleSelector, createLocator, LocatorError } from "./locator";
import { Pointer } from "./pointer";
import { computeScrollGesture } from "./scroll";
import { createTouchBackend, type TouchBackend } from "./touch";
import type {
  Capabilities,
  Device,
  DeviceOptions,
  DriverEvent,
  ElementBounds,
  ScrollOptions,
  TouchBackendInfo,
  TracingOptions,
  WindowMetrics,
} from "./types";

const DEFAULT_METRO_URL = "http://localhost:8081";
const DEFAULT_WAIT_TIMEOUT = 30_000;
const DEFAULT_POLLING_INTERVAL = 100;

/**
 * Error thrown when an operation times out.
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Result type from native module calls.
 */
type NativeResult<T> = { success: true; data: T } | { success: false; error: string; code: string };

export type RNDeviceOptions = DeviceOptions & CDPClientOptions;

/**
 * React Native device implementation using CDP.
 */
export class RNDevice implements Device {
  private readonly options: RNDeviceOptions;
  private readonly cdp: CDPClient;
  private readonly _pointer: Pointer;
  private _touchBackend: TouchBackend | null = null;
  private _touchBackendInfo: TouchBackendInfo | null = null;
  private _platform: "ios" | "android" = "ios";

  constructor(options: RNDeviceOptions = {}) {
    const timeout = options.timeout ?? DEFAULT_WAIT_TIMEOUT;
    this.options = {
      metroUrl: options.metroUrl ?? DEFAULT_METRO_URL,
      timeout,
      ...options,
    };
    this.cdp = new CDPClient({ timeout });
    this._pointer = new Pointer(null, this);
  }

  // --- Connection ---

  async connect(): Promise<void> {
    const metroUrl = this.options.metroUrl ?? DEFAULT_METRO_URL;
    const targets = await discoverTargets(metroUrl);
    const target = selectTarget(targets, this.options);

    await this.cdp.connect(target.webSocketDebuggerUrl);

    // Detect platform from target info or via JS
    this._platform = await this.detectPlatform(target);

    const { backend, selection } = await createTouchBackend(
      {
        platform: this._platform,
        evaluate: this.evaluate.bind(this),
        waitForTimeout: this.waitForTimeout.bind(this),
      },
      this.options.touch,
    );
    this._touchBackend = backend;
    const backendInfo: TouchBackendInfo = {
      selected: selection.backend,
      available: selection.available,
    };
    if (selection.reason !== undefined) {
      backendInfo.reason = selection.reason;
    }
    this._touchBackendInfo = backendInfo;
    this._pointer.setBackend(backend);
  }

  async disconnect(): Promise<void> {
    if (this._touchBackend) {
      await this._touchBackend.dispose();
      this._touchBackend = null;
    }
    await this.cdp.disconnect();
  }

  async ping(): Promise<boolean> {
    return this.cdp.ping();
  }

  // --- JS Evaluation (Phase 1) ---

  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.cdp.evaluate<T>(expression);
    // Trace the evaluate call if tracing is active
    // We do this after the call to avoid tracing internal startTracing/stopTracing calls
    if (!expression.includes("startTracing") && !expression.includes("stopTracing")) {
      try {
        await this.cdp.evaluate(
          `globalThis.__RN_DRIVER__?.traceEvent?.("evaluate", { expression: ${JSON.stringify(expression.slice(0, 200))} })`,
        );
      } catch {
        // Ignore errors from tracing injection
      }
    }
    return result;
  }

  // --- Locators (Phase 3) ---

  getByTestId(testId: string): Locator {
    return createLocator(this, { type: "testId", value: testId });
  }

  getByText(text: string, options?: { exact?: boolean }): Locator {
    return createLocator(this, {
      type: "text",
      value: text,
      exact: options?.exact ?? false,
    });
  }

  getByRole(role: string, options?: { name?: string }): Locator {
    return createLocator(this, buildRoleSelector(role, options));
  }

  // --- Pointer/Touch (Phase 2) ---

  get pointer(): Pointer {
    return this._pointer;
  }

  /**
   * Scroll content by a delta via a single swipe gesture (no element target).
   * Geometry is resolved by the pure {@link computeScrollGesture}; this only
   * wires window metrics to the pointer backend.
   */
  async scroll(options: ScrollOptions): Promise<void> {
    const metrics = await this.getWindowMetrics();
    await this._pointer.swipe(computeScrollGesture(metrics, options));
  }

  // --- Screenshots (Phase 3) ---

  async screenshot(options?: { clip?: ElementBounds }): Promise<Buffer> {
    let result: NativeResult<string>;

    if (options?.clip) {
      // Capture specific region
      const { x, y, width, height } = options.clip;
      result = await this.evaluate<NativeResult<string>>(
        buildHarnessCall(
          "screenshot.captureRegion",
          `{ x: ${x}, y: ${y}, width: ${width}, height: ${height} }`,
        ),
      );
    } else {
      // Capture full screen
      result = await this.evaluate<NativeResult<string>>(
        buildHarnessCall("screenshot.captureScreen"),
      );
    }

    if (!result.success) {
      throw new LocatorError(result.error, result.code);
    }

    // Decode base64 to Buffer
    return Buffer.from(result.data, "base64");
  }

  // --- Navigation/Lifecycle (Phase 3) ---

  async openURL(url: string): Promise<void> {
    const result = await this.evaluate<NativeResult<void>>(
      buildHarnessCall("lifecycle.openURL", JSON.stringify(url)),
    );

    if (!result.success) {
      throw new LocatorError(result.error, result.code);
    }
  }

  async reload(): Promise<void> {
    const result = await this.evaluate<NativeResult<void>>(buildHarnessCall("lifecycle.reload"));

    if (!result.success) {
      throw new LocatorError(result.error, result.code);
    }
  }

  async background(): Promise<void> {
    const result = await this.evaluate<NativeResult<void>>(
      buildHarnessCall("lifecycle.background"),
    );

    if (!result.success) {
      throw new LocatorError(result.error, result.code);
    }
  }

  async foreground(): Promise<void> {
    const result = await this.evaluate<NativeResult<void>>(
      buildHarnessCall("lifecycle.foreground"),
    );

    if (!result.success) {
      throw new LocatorError(result.error, result.code);
    }
  }

  // --- Capabilities Detection ---

  async capabilities(): Promise<Capabilities> {
    return this.evaluate<Capabilities>(buildCapabilitiesExpression());
  }

  // --- Utilities (Phase 1) ---

  async waitForTimeout(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async waitForFunction<T>(
    expression: string,
    options?: { timeout?: number; polling?: number },
  ): Promise<T> {
    const timeout = options?.timeout ?? this.options.timeout ?? DEFAULT_WAIT_TIMEOUT;
    const polling = options?.polling ?? DEFAULT_POLLING_INTERVAL;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const result = await this.evaluate<T>(expression);
      if (result) {
        return result;
      }
      await this.waitForTimeout(polling);
    }

    throw new TimeoutError(
      `waitForFunction timed out after ${timeout}ms: ${expression.slice(0, 100)}...`,
    );
  }

  // --- Core Primitives ---

  async getWindowMetrics(): Promise<WindowMetrics> {
    return this.evaluate<WindowMetrics>(buildHarnessCall("getWindowMetrics"));
  }

  async getFrameCount(): Promise<number> {
    return this.evaluate<number>(buildHarnessCall("getFrameCount"));
  }

  async waitForRaf(count: number = 1): Promise<void> {
    const startFrame = await this.getFrameCount();
    const targetFrame = startFrame + count;
    await this.waitForFrameCount(targetFrame);
  }

  async waitForFrameCount(target: number): Promise<void> {
    const timeout = this.options.timeout ?? DEFAULT_WAIT_TIMEOUT;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const current = await this.getFrameCount();
      if (current >= target) {
        return;
      }
      // Use a short polling interval since RAF fires at ~16ms (60fps)
      await this.waitForTimeout(8);
    }

    throw new TimeoutError(`waitForFrameCount(${target}) timed out after ${timeout}ms`);
  }

  async getTouchBackendInfo(): Promise<TouchBackendInfo> {
    if (!this._touchBackendInfo) {
      throw new Error("Device not connected. Call connect() first.");
    }
    return this._touchBackendInfo;
  }

  async startTracing(options?: TracingOptions): Promise<void> {
    const optionsJson = JSON.stringify(options ?? {});
    await this.evaluate(buildHarnessCall("startTracing", optionsJson));
  }

  async stopTracing(): Promise<{ events: DriverEvent[] }> {
    return this.evaluate<{ events: DriverEvent[] }>(buildHarnessCall("stopTracing"));
  }

  // --- Platform Info ---

  get platform(): "ios" | "android" {
    return this._platform;
  }

  // --- Private helpers ---

  private async detectPlatform(target: {
    deviceName?: string;
    title?: string;
  }): Promise<"ios" | "android"> {
    // Try to detect from target metadata first
    const name = target.deviceName?.toLowerCase() ?? target.title?.toLowerCase() ?? "";
    if (name.includes("iphone") || name.includes("ipad") || name.includes("ios")) {
      return "ios";
    }
    if (name.includes("android") || name.includes("pixel") || name.includes("samsung")) {
      return "android";
    }

    // Fall back to JS detection
    try {
      const platform = await this.evaluate<string>("require('react-native').Platform.OS");
      if (platform === "ios" || platform === "android") {
        return platform;
      }
    } catch {
      // Ignore evaluation errors
    }

    // Default to iOS
    return "ios";
  }
}

/**
 * Create a device instance with the given options.
 */
export function createDevice(options?: RNDeviceOptions): RNDevice {
  return new RNDevice(options);
}
