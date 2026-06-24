import type { ElementInfo, NativeResult } from '@unrulysystems/rn-driver-shared-types'
// Type-only import of the driver↔harness wire contract. tsup/esbuild elides
// type-only imports, so the built dist gains NO runtime dependency on harness/.
import type { FillDispatch } from '../harness/fill'
import { buildHarnessCall } from './harness-expressions'
import { computeScrollIntoViewStep, isSamePosition, scrollForDirection } from './scroll'
import { waitForStable } from './wait-for-stable'
import type {
  Capabilities,
  ElementBounds,
  Locator,
  ScrollIntoViewOptions,
  ScrollOptions,
  TapOptions,
  WaitForOptions,
  WaitForState,
  WindowMetrics,
} from './types'

/**
 * Parent context for scoped queries.
 * Used to filter results to elements within a parent's bounds.
 */
export type ParentContext = {
  /** Parent element bounds for filtering */
  bounds: ElementBounds
}

/**
 * Selector types for locating elements.
 */
export type LocatorSelector =
  | { type: 'testId'; value: string; index?: number; parent?: ParentContext }
  | { type: 'text'; value: string; exact: boolean; index?: number; parent?: ParentContext }
  | { type: 'role'; value: string; name?: string; index?: number; parent?: ParentContext }

/**
 * Interface for device that supports evaluate() and pointer.
 * Avoids circular dependency with Device type.
 */
interface Evaluator {
  evaluate<T>(expression: string): Promise<T>
  pointer: {
    tap(x: number, y: number, options?: TapOptions): Promise<void>
  }
  waitForTimeout(ms: number): Promise<void>
  capabilities(): Promise<Capabilities>
  /** Window metrics, used to decide when an element is within the viewport. */
  getWindowMetrics(): Promise<WindowMetrics>
  /** Content-delta scroll, used to bring elements into view. */
  scroll(options: ScrollOptions): Promise<void>
  /** Platform for conditional behavior */
  platform: 'ios' | 'android'
}

/**
 * Error thrown when a locator operation fails.
 */
export class LocatorError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'LocatorError'
    this.code = code
  }
}

const DEFAULT_WAIT_TIMEOUT = 30_000
const DEFAULT_POLLING_INTERVAL = 100
const DEFAULT_MAX_SCROLLS = 10
// scrollIntoView settle: after a swipe, poll the element position this often,
// up to this budget, until it stabilizes (ScrollView momentum settles).
const SCROLL_SETTLE_POLL_INTERVAL = 100
const SCROLL_SETTLE_TIMEOUT = 2_000
// Minimum scroll magnitude per scrollIntoView step, in logical points. A swipe
// shorter than the platform touch slop (~10pt) is treated as a tap and does not
// scroll at all, leaving the element stuck just short of fully visible. Flooring
// the magnitude guarantees each step actually moves the content; overshooting a
// small residual is harmless because the element only needs to land anywhere in
// the (much larger) in-view band, and the loop re-measures.
const MIN_SCROLL_STEP = 64

/**
 * Locator implementation for finding and interacting with RN views.
 * Uses native modules via the harness bridge when available.
 */
export class LocatorImpl implements Locator {
  /** @internal Device reference */
  readonly device: Evaluator
  protected readonly selector: LocatorSelector

  constructor(device: Evaluator, selector: LocatorSelector) {
    this.device = device
    this.selector = selector
  }

  /**
   * Tap the element center.
   * Requires RNDriverTouchInjector native module (no JS fallback).
   * Auto-waits for element to be visible and enabled.
   */
  async tap(): Promise<void> {
    const info = await this.waitForActionable()
    const capabilities = await this.device.capabilities()

    if (!capabilities.touchNative) {
      throw new LocatorError(
        'RNDriverTouchInjector native module not installed. Install @unrulysystems/rn-driver-touch and rebuild your app.',
        'NOT_SUPPORTED',
      )
    }

    const center = {
      x: info.bounds.x + info.bounds.width / 2,
      y: info.bounds.y + info.bounds.height / 2,
    }
    await this.device.pointer.tap(center.x, center.y)
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
      'Keyboard input requires RNDriverKeyboard native module (not yet implemented). ' +
        'Workaround: Use device.evaluate() to set TextInput text via setNativeProps.',
      'NOT_SUPPORTED',
    )
  }

  /**
   * fill() resolves its target IN-APP via a testID-only fiber match — the harness
   * does NOT run the full locator query pipeline. So fill() supports ONLY a plain
   * `getByTestId(...)` locator. A `nth()`/scoped/role/text locator would pass the
   * driver-side actionable wait (which DOES honor those) and then have the harness
   * fill the FIRST testID match — a different, wrong element — or fail late. Reject
   * those up front, before waiting, with an actionable error. Overridden by
   * ScopedLocatorImpl (always unsupported).
   *
   * @throws LocatorError "NOT_SUPPORTED" when the locator is not a plain testId.
   */
  protected assertFillableSelector(): void {
    if (this.selector.type !== 'testId') {
      throw new LocatorError(
        `fill() currently resolves only a plain testId locator; a ${this.selector.type} selector ` +
          `is not yet supported in-app (the harness matches on testID). ` +
          `Give the input a unique testID and use getByTestId(...).fill().`,
        'NOT_SUPPORTED',
      )
    }
    if (this.selector.index !== undefined) {
      throw new LocatorError(
        `fill() does not support nth()/first()/last(): the harness fills the first testID match, ` +
          `not the indexed one. Give the target a unique testID and fill that.`,
        'NOT_SUPPORTED',
      )
    }
    if (this.selector.parent !== undefined) {
      throw new LocatorError(
        `fill() does not support a scoped (within-parent) locator: the harness matches testID ` +
          `globally. Give the target a unique testID and fill that.`,
        'NOT_SUPPORTED',
      )
    }
  }

  /**
   * Set a text input's value in one shot. Auto-waits for the element to be
   * actionable, then delegates to the in-app harness, which resolves the
   * TextInput's React component and fires a synthetic change so controlled inputs
   * update React state (see harness/fill.ts). No native keyboard module required.
   *
   * LIMITATION: supports only a plain `getByTestId(...)` locator (see
   * {@link assertFillableSelector}). nth()/scoped/role/text locators throw
   * NOT_SUPPORTED rather than silently filling the wrong input.
   *
   * @throws LocatorError "NOT_SUPPORTED" if the locator is not a plain testId, or
   *   if the harness cannot resolve the input.
   * @throws LocatorError "NOT_A_TEXT_INPUT" if the element is not a text input.
   */
  async fill(text: string): Promise<void> {
    // Reject unsupported locator shapes BEFORE waiting so we never wait on one
    // element and then fill another (the silent wrong-target hazard).
    this.assertFillableSelector()
    // Auto-wait for the element to be actionable (exists + visible) before filling.
    await this.waitForActionable()
    // The synthetic-change dispatch must happen in-app (the harness resolves the
    // TextInput's React component). Ship only the minimal {type,value} the harness
    // matches on — not internal locator state (index/parent bounds).
    const fillSelector = { type: this.selector.type, value: this.selector.value }
    const args = `${JSON.stringify(fillSelector)}, ${JSON.stringify(text)}`
    const result = await this.device.evaluate<NativeResult<FillDispatch>>(
      buildHarnessCall('fill', args),
    )
    if (!result.success) {
      throw new LocatorError(result.error, result.code)
    }
  }

  /**
   * Wait for element to reach a specific state.
   * - "attached": element exists in the view tree
   * - "visible": element exists AND is visible
   * - "hidden": element exists but is NOT visible
   * - "detached": element does NOT exist
   */
  async waitFor(options?: WaitForOptions): Promise<void> {
    const state: WaitForState = options?.state ?? 'visible'
    const timeout = options?.timeout ?? DEFAULT_WAIT_TIMEOUT
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      const result = await this.query()

      // Fail fast on non-retryable errors (except NOT_FOUND which is expected for "detached")
      if (
        !result.success &&
        result.code !== 'NOT_FOUND' &&
        (result.code === 'NOT_SUPPORTED' ||
          result.code === 'INTERNAL' ||
          result.code === 'MULTIPLE_FOUND')
      ) {
        throw new LocatorError(result.error, result.code)
      }

      // Check if the desired state is reached
      if (this.matchesState(result, state)) {
        return
      }

      await this.device.waitForTimeout(DEFAULT_POLLING_INTERVAL)
    }

    throw new LocatorError(
      `waitFor(state="${state}") timed out after ${timeout}ms for ${this.toString()}`,
      'TIMEOUT',
    )
  }

  /**
   * Check if the query result matches the desired state.
   */
  private matchesState(result: NativeResult<ElementInfo>, state: WaitForState): boolean {
    switch (state) {
      case 'attached':
        // Element exists (query succeeded)
        return result.success
      case 'visible':
        // Element exists AND is visible
        return result.success && result.data.visible
      case 'hidden':
        // Element exists but is NOT visible
        return result.success && !result.data.visible
      case 'detached':
        // Element does NOT exist
        return !result.success && result.code === 'NOT_FOUND'
      default: {
        const _exhaustive: never = state
        throw new Error(`Unknown state: ${_exhaustive}`)
      }
    }
  }

  /**
   * Check if element exists and is visible.
   * Throws if view-tree module is not installed.
   */
  async isVisible(): Promise<boolean> {
    const result = await this.query()
    if (!result.success) {
      // Throw on NOT_SUPPORTED to surface missing module error
      if (result.code === 'NOT_SUPPORTED') {
        throw new LocatorError(result.error, result.code)
      }
      // NOT_FOUND means element doesn't exist, so not visible
      return false
    }
    return result.data.visible
  }

  /**
   * Get element bounds in logical points.
   * Returns null if element not found.
   * Throws if view-tree module is not installed.
   */
  async bounds(): Promise<ElementBounds | null> {
    const result = await this.query()
    if (!result.success) {
      // Throw on NOT_SUPPORTED to surface missing module error
      if (result.code === 'NOT_SUPPORTED') {
        throw new LocatorError(result.error, result.code)
      }
      return null
    }
    return result.data.bounds
  }

  /**
   * Capture screenshot of element.
   * Uses native captureElement when available, falls back to region capture.
   */
  async screenshot(): Promise<Buffer> {
    const info = await this.resolve()

    // Use captureElement which orchestrates viewTree + screenshot in harness
    const result = await this.device.evaluate<NativeResult<string>>(
      buildHarnessCall('screenshot.captureElement', JSON.stringify(info.handle)),
    )

    if (!result.success) {
      throw new LocatorError(result.error, result.code)
    }

    // Decode base64 to Buffer
    return Buffer.from(result.data, 'base64')
  }

  /**
   * Scroll the element into the viewport.
   *
   * Bounded loop: each iteration measures the element, and if it is not fully on
   * screen, issues one swipe (via `device.scroll`) toward it, then re-measures.
   * Direction is inferred from the measured bounds; when the element is not yet
   * in the view tree (e.g. virtualized content), `options.direction` drives a
   * blind scroll. The loop terminates on success, on reaching the scroll
   * boundary (no progress), or after `maxScrolls` — never spins unbounded.
   *
   * @throws LocatorError "TIMEOUT" if the boundary is hit or `maxScrolls` is
   * exhausted before the element is fully visible; "NOT_FOUND" if the element
   * never appears; or surfaces "NOT_SUPPORTED"/"INTERNAL"/"MULTIPLE_FOUND" from
   * the underlying query immediately.
   */
  async scrollIntoView(options?: ScrollIntoViewOptions): Promise<void> {
    const maxScrolls = options?.maxScrolls ?? DEFAULT_MAX_SCROLLS
    const margin = options?.margin ?? 0
    const blindDirection = options?.direction ?? 'down'
    // Fetched once: the viewport is assumed stable for the duration of a scroll
    // (orientation changes mid-scroll are not a real automation scenario), and
    // re-querying per iteration would add a CDP round-trip to every step.
    const metrics = await this.device.getWindowMetrics()

    // Leading-edge position recorded before the previous scroll, per axis, so we
    // can detect when a scroll made no progress (scroll container at its limit).
    let last: { axis: 'vertical' | 'horizontal'; position: number } | null = null

    for (let attempt = 0; ; attempt++) {
      const result = await this.query()

      if (!result.success) {
        // Non-retryable query errors surface immediately, like tap()/waitFor().
        if (
          result.code === 'NOT_SUPPORTED' ||
          result.code === 'INTERNAL' ||
          result.code === 'MULTIPLE_FOUND'
        ) {
          throw new LocatorError(result.error, result.code)
        }
        // Not measurable yet (NOT_FOUND/NOT_VISIBLE/NOT_ENABLED): blind-scroll.
        if (attempt >= maxScrolls) {
          throw new LocatorError(
            `scrollIntoView: ${this.toString()} not found after ${maxScrolls} scroll(s)`,
            'NOT_FOUND',
          )
        }
        await this.device.scroll(scrollForDirection(blindDirection, metrics))
        last = null // position is unknown while unmeasurable
        continue
      }

      const step = computeScrollIntoViewStep(result.data.bounds, metrics, margin)
      if (step.inView) {
        return
      }

      if (attempt >= maxScrolls) {
        throw new LocatorError(
          `scrollIntoView: ${this.toString()} could not be brought fully into view after ${maxScrolls} scroll(s)`,
          'TIMEOUT',
        )
      }

      // Boundary detection: if the previous scroll on this axis did not move the
      // element, the container is at its limit — stop rather than spin.
      if (
        last !== null &&
        last.axis === step.axis &&
        isSamePosition(step.position, last.position)
      ) {
        throw new LocatorError(
          `scrollIntoView: reached scroll boundary before ${this.toString()} was fully visible`,
          'TIMEOUT',
        )
      }
      last = { axis: step.axis, position: step.position }

      // Floor the magnitude so the swipe clears the touch-slop threshold and
      // actually scrolls; preserve the direction.
      const magnitude = Math.max(Math.abs(step.delta), MIN_SCROLL_STEP)
      const signed = step.delta < 0 ? -magnitude : magnitude
      const scrollOptions: ScrollOptions =
        step.axis === 'vertical' ? { dy: signed } : { dx: signed }
      await this.device.scroll(scrollOptions)
      // The swipe finishes before the ScrollView settles (RN momentum continues
      // after pointer-up). Wait for the element position to stop changing before
      // the next measurement, otherwise the boundary detector reads a stale,
      // unchanged position and false-fires "reached scroll boundary".
      await this.settleAfterScroll(step.axis)
    }
  }

  /**
   * Poll the element's leading-edge position along `axis` until it stops moving
   * (the scroll has settled) or the settle budget elapses. Bounded; returns
   * early if the element stops being measurable.
   */
  private async settleAfterScroll(axis: 'vertical' | 'horizontal'): Promise<void> {
    await waitForStable(
      async () => {
        const result = await this.query()
        // No longer measurable (e.g. scrolled out of the tree) — stop waiting.
        if (!result.success) {
          return undefined
        }
        return axis === 'vertical' ? result.data.bounds.y : result.data.bounds.x
      },
      this.device,
      {
        timeout: SCROLL_SETTLE_TIMEOUT,
        pollInterval: SCROLL_SETTLE_POLL_INTERVAL,
        equals: isSamePosition,
      },
    )
  }

  /**
   * Returns a string representation of the locator for debugging.
   */
  toString(): string {
    const indexStr = this.selector.index !== undefined ? `.nth(${this.selector.index})` : ''
    switch (this.selector.type) {
      case 'testId':
        return `Locator(testId="${this.selector.value}")${indexStr}`
      case 'text':
        return `Locator(text="${this.selector.value}", exact=${this.selector.exact})${indexStr}`
      case 'role':
        return `Locator(role="${this.selector.value}"${this.selector.name ? `, name="${this.selector.name}"` : ''})${indexStr}`
      default: {
        const _exhaustive: never = this.selector
        throw new Error(`Unknown selector type: ${_exhaustive}`)
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
    return new ScopedLocatorImpl(this.device, { type: 'testId', value: testId }, this)
  }

  /**
   * Find element containing text within this element's subtree.
   * Scoped queries filter results to elements within this element's bounds.
   */
  getByText(text: string, options?: { exact?: boolean }): Locator {
    return new ScopedLocatorImpl(
      this.device,
      { type: 'text', value: text, exact: options?.exact ?? false },
      this,
    )
  }

  /**
   * Find element by accessibility role within this element's subtree.
   * Scoped queries filter results to elements within this element's bounds.
   */
  getByRole(role: string, options?: { name?: string }): Locator {
    return new ScopedLocatorImpl(this.device, buildRoleSelector(role, options), this)
  }

  /**
   * Return the nth matching element (0-indexed).
   */
  nth(index: number): Locator {
    return new LocatorImpl(this.device, { ...this.selector, index })
  }

  /**
   * Return the first matching element.
   */
  first(): Locator {
    return this.nth(0)
  }

  /**
   * Return the last matching element.
   */
  last(): Locator {
    return this.nth(-1)
  }

  /**
   * Resolve the element, throwing if not found.
   */
  private async resolve(): Promise<ElementInfo> {
    const result = await this.query()
    if (!result.success) {
      throw new LocatorError(result.error, result.code)
    }
    return result.data
  }

  /**
   * Wait for element to be visible and enabled, returning latest element info.
   */
  private async waitForActionable(): Promise<ElementInfo> {
    const timeout = DEFAULT_WAIT_TIMEOUT
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      const result = await this.query()

      if (!result.success) {
        if (
          result.code === 'NOT_SUPPORTED' ||
          result.code === 'INTERNAL' ||
          result.code === 'MULTIPLE_FOUND'
        ) {
          throw new LocatorError(result.error, result.code)
        }

        // NOT_FOUND/NOT_VISIBLE/NOT_ENABLED should retry
        await this.device.waitForTimeout(DEFAULT_POLLING_INTERVAL)
        continue
      }

      if (result.data.visible && result.data.enabled) {
        return result.data
      }

      await this.device.waitForTimeout(DEFAULT_POLLING_INTERVAL)
    }

    throw new LocatorError(`tap() timed out after ${timeout}ms for ${this.toString()}`, 'TIMEOUT')
  }

  /**
   * Check if child bounds are within parent bounds.
   */
  protected isWithinParent(child: ElementBounds, parent: ElementBounds): boolean {
    // Child's top-left must be at or after parent's top-left
    // Child's bottom-right must be at or before parent's bottom-right
    const childRight = child.x + child.width
    const childBottom = child.y + child.height
    const parentRight = parent.x + parent.width
    const parentBottom = parent.y + parent.height

    return (
      child.x >= parent.x &&
      child.y >= parent.y &&
      childRight <= parentRight &&
      childBottom <= parentBottom
    )
  }

  /**
   * Filter elements to those within parent bounds.
   */
  protected filterByParent(elements: ElementInfo[], parent: ParentContext): ElementInfo[] {
    return elements.filter((el) => this.isWithinParent(el.bounds, parent.bounds))
  }

  /**
   * Query for the element using native module.
   * Uses findAllBy* + index selection when index is specified.
   * Filters by parent bounds when parent context is present.
   */
  protected async query(): Promise<NativeResult<ElementInfo>> {
    const index = this.selector.index
    const parent = this.selector.parent

    // If parent context is present, always use findAllBy* and filter
    if (parent !== undefined) {
      const result = await this.evaluateAllElements()

      if (!result.success) {
        return result as NativeResult<ElementInfo>
      }

      // Filter to elements within parent bounds
      const filtered = this.filterByParent(result.data, parent)
      return this.selectElementFromList(filtered, index, {
        emptySuffix: ' within parent',
        boundsSuffix: ' in parent',
      })
    }

    // No parent context - use original logic
    // If no index specified, use single-element query
    if (index === undefined) {
      const expr = this.buildSingleQueryExpression()
      return this.device.evaluate<NativeResult<ElementInfo>>(expr)
    }

    // Use findAllBy* and select by index
    const result = await this.evaluateAllElements()

    if (!result.success) {
      return result as NativeResult<ElementInfo>
    }

    return this.selectElementFromList(result.data, index, {
      emptySuffix: '',
      boundsSuffix: '',
    })
  }

  /**
   * Query for element info - public method for assertions.
   * Returns the full element info including text, enabled state, etc.
   */
  async getElementInfo(): Promise<NativeResult<ElementInfo>> {
    return this.query()
  }

  /**
   * Build expression for single-element query.
   */
  protected buildSingleQueryExpression(): string {
    return this.buildQueryExpression('single')
  }

  /**
   * Build expression for multi-element query.
   */
  protected buildAllQueryExpression(): string {
    return this.buildQueryExpression('all')
  }

  private buildQueryExpression(kind: 'single' | 'all'): string {
    const prefix = kind === 'single' ? 'findBy' : 'findAllBy'

    switch (this.selector.type) {
      case 'testId':
        return buildHarnessCall(`viewTree.${prefix}TestId`, JSON.stringify(this.selector.value))
      case 'text':
        return buildHarnessCall(
          `viewTree.${prefix}Text`,
          `${JSON.stringify(this.selector.value)}, ${this.selector.exact}`,
        )
      case 'role': {
        const nameArg =
          this.selector.name !== undefined ? JSON.stringify(this.selector.name) : 'undefined'
        return buildHarnessCall(
          `viewTree.${prefix}Role`,
          `${JSON.stringify(this.selector.value)}, ${nameArg}`,
        )
      }
    }
  }

  protected async evaluateAllElements(): Promise<NativeResult<ElementInfo[]>> {
    const expr = this.buildAllQueryExpression()
    return this.device.evaluate<NativeResult<ElementInfo[]>>(expr)
  }

  protected selectElementFromList(
    elements: ElementInfo[],
    index: number | undefined,
    context: { emptySuffix: string; boundsSuffix: string },
  ): NativeResult<ElementInfo> {
    if (elements.length === 0) {
      return {
        success: false,
        error: `No elements found${context.emptySuffix} for ${this.toString()}`,
        code: 'NOT_FOUND',
      }
    }

    const targetIndex = index ?? 0
    const actualIndex = targetIndex < 0 ? elements.length + targetIndex : targetIndex
    const element = elements[actualIndex]

    // A missing element is the only out-of-bounds signal we need: negative or
    // overflowing indices both resolve to undefined on the array.
    if (!element) {
      return {
        success: false,
        error: `Index ${targetIndex} out of bounds (found ${elements.length} elements${context.boundsSuffix})`,
        code: 'NOT_FOUND',
      }
    }

    return { success: true, data: element }
  }
}

/**
 * Scoped locator that lazily resolves parent bounds.
 * Used by chaining methods to filter child queries within parent bounds.
 */
class ScopedLocatorImpl extends LocatorImpl {
  private readonly parentLocator: LocatorImpl
  private cachedParentContext: ParentContext | null = null

  constructor(device: Evaluator, selector: LocatorSelector, parentLocator: LocatorImpl) {
    super(device, selector)
    this.parentLocator = parentLocator
  }

  /**
   * Override query to resolve parent bounds lazily and filter within parent.
   * Re-resolves parent on each query if not cached, allowing parent to appear later.
   */
  protected override async query(): Promise<NativeResult<ElementInfo>> {
    // Resolve parent context - re-resolve each time if not found previously
    // This allows waitFor to retry if parent appears later
    if (this.cachedParentContext === null) {
      const parentResult = await this.parentLocator.getElementInfo()
      if (parentResult.success) {
        this.cachedParentContext = { bounds: parentResult.data.bounds }
      } else {
        // Propagate original error code - only NOT_FOUND allows retry,
        // MULTIPLE_FOUND/NOT_SUPPORTED/etc. surface actionable errors immediately
        return {
          success: false,
          error: `Parent element error for scoped query ${this.toString()}: ${parentResult.error}`,
          code: parentResult.code,
        }
      }
    }
    // Narrow to non-null for TypeScript (guaranteed by check above)
    const parentContext = this.cachedParentContext

    // Query all elements and filter by parent bounds
    const expr = this.buildAllQueryExpression()
    const result = await this.device.evaluate<NativeResult<ElementInfo[]>>(expr)

    if (!result.success) {
      return result as NativeResult<ElementInfo>
    }

    // Filter to elements within parent bounds
    const filtered = this.filterByParent(result.data, parentContext)
    return this.selectElementFromList(filtered, this.selector.index, {
      emptySuffix: ' within parent',
      boundsSuffix: ' in parent',
    })
  }

  /**
   * A scoped locator is inherently within-parent, which the testID-only harness
   * fill path cannot honor — always reject, regardless of selector shape.
   */
  protected override assertFillableSelector(): void {
    throw new LocatorError(
      `fill() does not support a scoped (within-parent) locator: the harness matches testID ` +
        `globally. Give the target a unique testID and use a top-level getByTestId(...).fill().`,
      'NOT_SUPPORTED',
    )
  }

  /**
   * Return the nth matching element within the parent scope.
   */
  override nth(index: number): Locator {
    return new ScopedLocatorImpl(this.device, { ...this.selector, index }, this.parentLocator)
  }

  /**
   * Return the first matching element within the parent scope.
   */
  override first(): Locator {
    return this.nth(0)
  }

  /**
   * Return the last matching element within the parent scope.
   */
  override last(): Locator {
    return this.nth(-1)
  }
}

/**
 * Create a locator for the given device and selector.
 */
export function createLocator(device: Evaluator, selector: LocatorSelector): Locator {
  return new LocatorImpl(device, selector)
}

export function buildRoleSelector(role: string, options?: { name?: string }): LocatorSelector {
  const selector: LocatorSelector = { type: 'role', value: role }
  if (options?.name !== undefined) {
    selector.name = options.name
  }
  return selector
}

/**
 * Re-export Locator type for external use.
 */
export type { Locator }
