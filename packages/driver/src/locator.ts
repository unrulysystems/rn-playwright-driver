import type { ElementBounds, Locator, TapOptions, WaitForOptions, WaitForState } from "./types";

/**
 * Parent context for scoped queries.
 * Used to filter results to elements within a parent's bounds.
 */
export type ParentContext = {
  /** Parent element bounds for filtering */
  bounds: ElementBounds;
};

/**
 * Selector types for locating elements.
 */
export type LocatorSelector =
  | { type: "testId"; value: string; index?: number; parent?: ParentContext }
  | { type: "text"; value: string; exact: boolean; index?: number; parent?: ParentContext }
  | { type: "role"; value: string; name?: string; index?: number; parent?: ParentContext };

/**
 * Interface for device that supports evaluate() and pointer.
 * Avoids circular dependency with Device type.
 */
interface Evaluator {
  evaluate<T>(expression: string): Promise<T>;
  pointer: {
    tap(x: number, y: number, options?: TapOptions): Promise<void>;
  };
  waitForTimeout(ms: number): Promise<void>;
  /** Platform for conditional behavior */
  platform: "ios" | "android";
}

/**
 * Element info from native module.
 */
export type ElementInfo = {
  handle: string;
  testId: string | null;
  text: string | null;
  role: string | null;
  label: string | null;
  bounds: ElementBounds;
  visible: boolean;
  enabled: boolean;
};

/**
 * Result type from native module calls.
 */
type NativeResult<T> = { success: true; data: T } | { success: false; error: string; code: string };

/**
 * Error thrown when a locator operation fails.
 */
export class LocatorError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "LocatorError";
    this.code = code;
  }
}

const DEFAULT_WAIT_TIMEOUT = 30_000;
const DEFAULT_POLLING_INTERVAL = 100;

/**
 * Locator implementation for finding and interacting with RN views.
 * Uses native modules via the harness bridge when available.
 */
export class LocatorImpl implements Locator {
  /** @internal Device reference */
  readonly device: Evaluator;
  protected readonly selector: LocatorSelector;

  constructor(device: Evaluator, selector: LocatorSelector) {
    this.device = device;
    this.selector = selector;
  }

  /**
   * Tap the element center.
   * Uses native tap via viewTree module which handles:
   * 1. UIControl.sendActions (for native iOS buttons)
   * 2. accessibilityActivate (for RN Pressable with accessibilityRole)
   * 3. Synthetic touch event injection (for other RN views)
   * Falls back to pointer tap if native module unavailable.
   */
  async tap(): Promise<void> {
    const info = await this.resolve();

    // Try native tap (handles UIControl, accessibility activation, and synthetic touch)
    const capabilities = await this.device.evaluate<{ viewTree: boolean }>(
      "globalThis.__RN_DRIVER__.capabilities",
    );

    if (capabilities.viewTree) {
      const tapResult = await this.device.evaluate<NativeResult<boolean>>(
        `globalThis.__RN_DRIVER__.viewTree.tap(${JSON.stringify(info.handle)})`,
      );

      if (tapResult.success) {
        return;
      }
      // Native tap failed - throw error with details
      if (!tapResult.success) {
        throw new LocatorError(
          `Native tap failed: ${tapResult.error}`,
          tapResult.code as "NOT_FOUND" | "TAP_FAILED",
        );
      }
    }

    // Fallback: pointer-based tap (when native module not available)
    const center = {
      x: info.bounds.x + info.bounds.width / 2,
      y: info.bounds.y + info.bounds.height / 2,
    };
    await this.device.pointer.tap(center.x, center.y);
  }

  /**
   * Type text into the element.
   *
   * NOT YET IMPLEMENTED: Keyboard input requires a native keyboard simulation module
   * (RNDriverKeyboard) that is not yet available. This is tracked as a future roadmap item.
   *
   * Workaround: Use device.evaluate() to set text directly on TextInput refs:
   * ```typescript
   * await device.evaluate(`
   *   const input = ... // get ref to TextInput
   *   input.setNativeProps({ text: "your text" });
   * `);
   * ```
   *
   * @throws LocatorError with code "NOT_SUPPORTED"
   */
  async type(_text: string): Promise<void> {
    // Keyboard simulation requires native module support for:
    // 1. Focus management (showing/hiding keyboard)
    // 2. Key event injection (keyDown, keyUp, character input)
    // 3. IME composition handling
    // This is complex platform-specific code not yet implemented.
    throw new LocatorError(
      "Keyboard input requires RNDriverKeyboard native module (not yet implemented). " +
        "Workaround: Use device.evaluate() to set TextInput text via setNativeProps.",
      "NOT_SUPPORTED",
    );
  }

  /**
   * Wait for element to reach a specific state.
   * - "attached": element exists in the view tree
   * - "visible": element exists AND is visible
   * - "hidden": element exists but is NOT visible
   * - "detached": element does NOT exist
   */
  async waitFor(options?: WaitForOptions): Promise<void> {
    const state: WaitForState = options?.state ?? "visible";
    const timeout = options?.timeout ?? DEFAULT_WAIT_TIMEOUT;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const result = await this.query();

      // Fail fast on non-retryable errors (except NOT_FOUND which is expected for "detached")
      if (
        !result.success &&
        result.code !== "NOT_FOUND" &&
        (result.code === "NOT_SUPPORTED" ||
          result.code === "INTERNAL" ||
          result.code === "MULTIPLE_FOUND")
      ) {
        throw new LocatorError(result.error, result.code);
      }

      // Check if the desired state is reached
      if (this.matchesState(result, state)) {
        return;
      }

      await this.device.waitForTimeout(DEFAULT_POLLING_INTERVAL);
    }

    throw new LocatorError(
      `waitFor(state="${state}") timed out after ${timeout}ms for ${this.toString()}`,
      "TIMEOUT",
    );
  }

  /**
   * Check if the query result matches the desired state.
   */
  private matchesState(result: NativeResult<ElementInfo>, state: WaitForState): boolean {
    switch (state) {
      case "attached":
        // Element exists (query succeeded)
        return result.success;
      case "visible":
        // Element exists AND is visible
        return result.success && result.data.visible;
      case "hidden":
        // Element exists but is NOT visible
        return result.success && !result.data.visible;
      case "detached":
        // Element does NOT exist
        return !result.success && result.code === "NOT_FOUND";
      default: {
        const _exhaustive: never = state;
        throw new Error(`Unknown state: ${_exhaustive}`);
      }
    }
  }

  /**
   * Check if element exists and is visible.
   * Throws if view-tree module is not installed.
   */
  async isVisible(): Promise<boolean> {
    const result = await this.query();
    if (!result.success) {
      // Throw on NOT_SUPPORTED to surface missing module error
      if (result.code === "NOT_SUPPORTED") {
        throw new LocatorError(result.error, result.code);
      }
      // NOT_FOUND means element doesn't exist, so not visible
      return false;
    }
    return result.data.visible;
  }

  /**
   * Get element bounds in logical points.
   * Returns null if element not found.
   * Throws if view-tree module is not installed.
   */
  async bounds(): Promise<ElementBounds | null> {
    const result = await this.query();
    if (!result.success) {
      // Throw on NOT_SUPPORTED to surface missing module error
      if (result.code === "NOT_SUPPORTED") {
        throw new LocatorError(result.error, result.code);
      }
      return null;
    }
    return result.data.bounds;
  }

  /**
   * Capture screenshot of element.
   * Uses native captureElement when available, falls back to region capture.
   */
  async screenshot(): Promise<Buffer> {
    const info = await this.resolve();

    // Use captureElement which orchestrates viewTree + screenshot in harness
    const result = await this.device.evaluate<NativeResult<string>>(
      `globalThis.__RN_DRIVER__.screenshot.captureElement(${JSON.stringify(info.handle)})`,
    );

    if (!result.success) {
      throw new LocatorError(result.error, result.code);
    }

    // Decode base64 to Buffer
    return Buffer.from(result.data, "base64");
  }

  /**
   * Scroll the element into view.
   *
   * NOT YET IMPLEMENTED: Scroll-to-view requires either:
   * 1. A native module that can programmatically scroll ScrollView/FlatList containers
   * 2. Integration with React Native's scrollToEnd/scrollTo methods via refs
   *
   * Workaround: Use device.evaluate() to call scroll methods on ScrollView refs:
   * ```typescript
   * await device.evaluate(`
   *   const scrollView = ... // get ref to ScrollView
   *   scrollView.scrollTo({ y: 500, animated: true });
   * `);
   * ```
   *
   * @throws LocatorError with code "NOT_SUPPORTED"
   */
  async scrollIntoView(): Promise<void> {
    // ScrollIntoView requires:
    // 1. Finding the nearest scrollable ancestor (ScrollView, FlatList, etc.)
    // 2. Calculating the scroll offset needed to bring element into view
    // 3. Invoking scroll methods on the container
    // This requires native module support not yet implemented.
    throw new LocatorError(
      "scrollIntoView requires native scroll integration (not yet implemented). " +
        "Workaround: Use device.evaluate() to call scrollTo on ScrollView refs.",
      "NOT_SUPPORTED",
    );
  }

  /**
   * Returns a string representation of the locator for debugging.
   */
  toString(): string {
    const indexStr = this.selector.index !== undefined ? `.nth(${this.selector.index})` : "";
    switch (this.selector.type) {
      case "testId":
        return `Locator(testId="${this.selector.value}")${indexStr}`;
      case "text":
        return `Locator(text="${this.selector.value}", exact=${this.selector.exact})${indexStr}`;
      case "role":
        return `Locator(role="${this.selector.value}"${this.selector.name ? `, name="${this.selector.name}"` : ""})${indexStr}`;
      default: {
        const _exhaustive: never = this.selector;
        throw new Error(`Unknown selector type: ${_exhaustive}`);
      }
    }
  }

  // --- Chaining methods ---

  /**
   * Find element by testID within this element's subtree.
   * Scoped queries filter results to elements within this element's bounds.
   *
   * Note: Scoping requires resolving the parent element first, adding latency.
   * For best performance, use specific testIDs rather than deep chaining.
   */
  getByTestId(testId: string): Locator {
    // Return a ScopedLocator that will resolve parent bounds lazily
    return new ScopedLocatorImpl(this.device, { type: "testId", value: testId }, this);
  }

  /**
   * Find element containing text within this element's subtree.
   * Scoped queries filter results to elements within this element's bounds.
   */
  getByText(text: string, options?: { exact?: boolean }): Locator {
    return new ScopedLocatorImpl(
      this.device,
      { type: "text", value: text, exact: options?.exact ?? false },
      this,
    );
  }

  /**
   * Find element by accessibility role within this element's subtree.
   * Scoped queries filter results to elements within this element's bounds.
   */
  getByRole(role: string, options?: { name?: string }): Locator {
    const selector: LocatorSelector = { type: "role", value: role };
    if (options?.name !== undefined) {
      selector.name = options.name;
    }
    return new ScopedLocatorImpl(this.device, selector, this);
  }

  /**
   * Return the nth matching element (0-indexed).
   */
  nth(index: number): Locator {
    return new LocatorImpl(this.device, { ...this.selector, index });
  }

  /**
   * Return the first matching element.
   */
  first(): Locator {
    return this.nth(0);
  }

  /**
   * Return the last matching element.
   */
  last(): Locator {
    return this.nth(-1);
  }

  /**
   * Resolve the element, throwing if not found.
   */
  private async resolve(): Promise<ElementInfo> {
    const result = await this.query();
    if (!result.success) {
      throw new LocatorError(result.error, result.code);
    }
    return result.data;
  }

  /**
   * Check if child bounds are within parent bounds.
   */
  protected isWithinParent(child: ElementBounds, parent: ElementBounds): boolean {
    // Child's top-left must be at or after parent's top-left
    // Child's bottom-right must be at or before parent's bottom-right
    const childRight = child.x + child.width;
    const childBottom = child.y + child.height;
    const parentRight = parent.x + parent.width;
    const parentBottom = parent.y + parent.height;

    return (
      child.x >= parent.x &&
      child.y >= parent.y &&
      childRight <= parentRight &&
      childBottom <= parentBottom
    );
  }

  /**
   * Filter elements to those within parent bounds.
   */
  protected filterByParent(elements: ElementInfo[], parent: ParentContext): ElementInfo[] {
    return elements.filter((el) => this.isWithinParent(el.bounds, parent.bounds));
  }

  /**
   * Query for the element using native module.
   * Uses findAllBy* + index selection when index is specified.
   * Filters by parent bounds when parent context is present.
   */
  protected async query(): Promise<NativeResult<ElementInfo>> {
    const index = this.selector.index;
    const parent = this.selector.parent;

    // If parent context is present, always use findAllBy* and filter
    if (parent !== undefined) {
      const expr = this.buildAllQueryExpression();
      const result = await this.device.evaluate<NativeResult<ElementInfo[]>>(expr);

      if (!result.success) {
        return result as NativeResult<ElementInfo>;
      }

      // Filter to elements within parent bounds
      const filtered = this.filterByParent(result.data, parent);

      if (filtered.length === 0) {
        return {
          success: false,
          error: `No elements found within parent for ${this.toString()}`,
          code: "NOT_FOUND",
        };
      }

      // Apply index selection
      const targetIndex = index ?? 0;
      const actualIndex = targetIndex < 0 ? filtered.length + targetIndex : targetIndex;

      if (actualIndex < 0 || actualIndex >= filtered.length) {
        return {
          success: false,
          error: `Index ${targetIndex} out of bounds (found ${filtered.length} elements in parent)`,
          code: "NOT_FOUND",
        };
      }

      return { success: true, data: filtered[actualIndex] };
    }

    // No parent context - use original logic
    // If no index specified, use single-element query
    if (index === undefined) {
      const expr = this.buildSingleQueryExpression();
      return this.device.evaluate<NativeResult<ElementInfo>>(expr);
    }

    // Use findAllBy* and select by index
    const expr = this.buildAllQueryExpression();
    const result = await this.device.evaluate<NativeResult<ElementInfo[]>>(expr);

    if (!result.success) {
      return result as NativeResult<ElementInfo>;
    }

    const elements = result.data;
    if (elements.length === 0) {
      return {
        success: false,
        error: `No elements found for ${this.toString()}`,
        code: "NOT_FOUND",
      };
    }

    // Handle negative index (e.g., -1 for last)
    const actualIndex = index < 0 ? elements.length + index : index;

    if (actualIndex < 0 || actualIndex >= elements.length) {
      return {
        success: false,
        error: `Index ${index} out of bounds (found ${elements.length} elements)`,
        code: "NOT_FOUND",
      };
    }

    return { success: true, data: elements[actualIndex] };
  }

  /**
   * Query for element info - public method for assertions.
   * Returns the full element info including text, enabled state, etc.
   */
  async getElementInfo(): Promise<NativeResult<ElementInfo>> {
    return this.query();
  }

  /**
   * Build expression for single-element query.
   */
  protected buildSingleQueryExpression(): string {
    switch (this.selector.type) {
      case "testId":
        return `globalThis.__RN_DRIVER__.viewTree.findByTestId(${JSON.stringify(this.selector.value)})`;
      case "text":
        return `globalThis.__RN_DRIVER__.viewTree.findByText(${JSON.stringify(this.selector.value)}, ${this.selector.exact})`;
      case "role": {
        const nameArg =
          this.selector.name !== undefined ? JSON.stringify(this.selector.name) : "undefined";
        return `globalThis.__RN_DRIVER__.viewTree.findByRole(${JSON.stringify(this.selector.value)}, ${nameArg})`;
      }
    }
  }

  /**
   * Build expression for multi-element query.
   */
  protected buildAllQueryExpression(): string {
    switch (this.selector.type) {
      case "testId":
        return `globalThis.__RN_DRIVER__.viewTree.findAllByTestId(${JSON.stringify(this.selector.value)})`;
      case "text":
        return `globalThis.__RN_DRIVER__.viewTree.findAllByText(${JSON.stringify(this.selector.value)}, ${this.selector.exact})`;
      case "role": {
        const nameArg =
          this.selector.name !== undefined ? JSON.stringify(this.selector.name) : "undefined";
        return `globalThis.__RN_DRIVER__.viewTree.findAllByRole(${JSON.stringify(this.selector.value)}, ${nameArg})`;
      }
    }
  }
}

/**
 * Scoped locator that lazily resolves parent bounds.
 * Used by chaining methods to filter child queries within parent bounds.
 */
class ScopedLocatorImpl extends LocatorImpl {
  private readonly parentLocator: LocatorImpl;
  private cachedParentContext: ParentContext | null = null;

  constructor(device: Evaluator, selector: LocatorSelector, parentLocator: LocatorImpl) {
    super(device, selector);
    this.parentLocator = parentLocator;
  }

  /**
   * Override query to resolve parent bounds lazily and filter within parent.
   * Re-resolves parent on each query if not cached, allowing parent to appear later.
   */
  protected override async query(): Promise<NativeResult<ElementInfo>> {
    // Resolve parent context - re-resolve each time if not found previously
    // This allows waitFor to retry if parent appears later
    if (this.cachedParentContext === null) {
      const parentResult = await this.parentLocator.getElementInfo();
      if (parentResult.success) {
        this.cachedParentContext = { bounds: parentResult.data.bounds };
      } else {
        // Propagate original error code - only NOT_FOUND allows retry,
        // MULTIPLE_FOUND/NOT_SUPPORTED/etc. surface actionable errors immediately
        return {
          success: false,
          error: `Parent element error for scoped query ${this.toString()}: ${parentResult.error}`,
          code: parentResult.code,
        };
      }
    }
    // Narrow to non-null for TypeScript (guaranteed by check above)
    const parentContext = this.cachedParentContext;

    // Query all elements and filter by parent bounds
    const expr = this.buildAllQueryExpression();
    const result = await this.device.evaluate<NativeResult<ElementInfo[]>>(expr);

    if (!result.success) {
      return result as NativeResult<ElementInfo>;
    }

    // Filter to elements within parent bounds
    const filtered = this.filterByParent(result.data, parentContext);

    if (filtered.length === 0) {
      return {
        success: false,
        error: `No elements found within parent for ${this.toString()}`,
        code: "NOT_FOUND",
      };
    }

    // Apply index selection
    const index = this.selector.index;
    const targetIndex = index ?? 0;
    const actualIndex = targetIndex < 0 ? filtered.length + targetIndex : targetIndex;

    if (actualIndex < 0 || actualIndex >= filtered.length) {
      return {
        success: false,
        error: `Index ${targetIndex} out of bounds (found ${filtered.length} elements in parent)`,
        code: "NOT_FOUND",
      };
    }

    return { success: true, data: filtered[actualIndex] };
  }

  /**
   * Override chaining to maintain scoped context.
   */
  override getByTestId(testId: string): Locator {
    return new ScopedLocatorImpl(this.device, { type: "testId", value: testId }, this);
  }

  override getByText(text: string, options?: { exact?: boolean }): Locator {
    return new ScopedLocatorImpl(
      this.device,
      { type: "text", value: text, exact: options?.exact ?? false },
      this,
    );
  }

  override getByRole(role: string, options?: { name?: string }): Locator {
    const selector: LocatorSelector = { type: "role", value: role };
    if (options?.name !== undefined) {
      selector.name = options.name;
    }
    return new ScopedLocatorImpl(this.device, selector, this);
  }

  /**
   * Return the nth matching element within the parent scope.
   */
  override nth(index: number): Locator {
    return new ScopedLocatorImpl(this.device, { ...this.selector, index }, this.parentLocator);
  }

  /**
   * Return the first matching element within the parent scope.
   */
  override first(): Locator {
    return this.nth(0);
  }

  /**
   * Return the last matching element within the parent scope.
   */
  override last(): Locator {
    return this.nth(-1);
  }
}

/**
 * Create a locator for the given device and selector.
 */
export function createLocator(device: Evaluator, selector: LocatorSelector): Locator {
  return new LocatorImpl(device, selector);
}

/**
 * Re-export Locator type for external use.
 */
export type { Locator };
