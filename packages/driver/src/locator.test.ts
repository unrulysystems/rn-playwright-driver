/**
 * Tests for Locator.scrollIntoView() against a simulated scrollable viewport.
 *
 * The fake device models a scroll container: the element sits at a fixed
 * position in content space, and `scroll()` advances a bounded scroll offset
 * (clamped per-gesture and by the container's content length), so the loop's
 * convergence, boundary detection, and not-found handling can be exercised
 * without a real device.
 */

import type { ElementInfo, NativeResult } from '@unrulysystems/rn-driver-shared-types'
import { describe, expect, it, vi } from 'vitest'
import { createLocator, type Locator } from './locator'
import type { Capabilities, ScrollOptions, TouchBackendInfo, WindowMetrics } from './types'

const METRICS: WindowMetrics = {
  width: 400,
  height: 800,
  pixelRatio: 2,
  scale: 2,
  fontScale: 1,
  orientation: 'portrait',
}

const CAPABILITIES: Capabilities = {
  apiVersion: 1,
  viewTree: true,
  viewTreeTap: true,
  screenshot: true,
  screenshotCaptureElement: true,
  lifecycle: true,
  touchNative: true,
}

const CAPABILITIES_WITHOUT_NATIVE_TOUCH: Capabilities = {
  ...CAPABILITIES,
  touchNative: false,
}

const CLI_TOUCH_BACKEND: TouchBackendInfo = {
  selected: 'cli',
  available: ['cli'],
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi)
}

type ScrollModel = {
  /** Fixed element position in content space. */
  contentX: number
  contentY: number
  width: number
  height: number
  /** Current scroll offset (content scrolled out of the top/left). */
  offsetX: number
  offsetY: number
  /** Max scroll offset = content length beyond the viewport. */
  maxOffsetX: number
  maxOffsetY: number
  /** Per-gesture movement cap, modeling the on-screen swipe band. */
  maxStep: number
  /**
   * Touch-slop threshold: a swipe shorter than this is treated as a tap and
   * does not scroll at all (models real RN ScrollView behavior). Default 0.
   */
  slop: number
}

function defaultModel(overrides: Partial<ScrollModel> = {}): ScrollModel {
  return {
    contentX: 0,
    contentY: 0,
    width: 100,
    height: 50,
    offsetX: 0,
    offsetY: 0,
    maxOffsetX: 0,
    maxOffsetY: 5000,
    maxStep: 400,
    slop: 0,
    ...overrides,
  }
}

/** A fake device implementing the structural shape the Locator needs. */
class FakeDevice {
  readonly platform = 'ios' as const
  readonly scrollCalls: ScrollOptions[] = []
  readonly pointer = { tap: async () => {} }

  constructor(
    private readonly model: ScrollModel,
    /** Optional override to simulate query failures / virtualization. */
    private readonly queryResult?: (calls: number) => NativeResult<ElementInfo>,
    /**
     * When true, a scroll does not move the element immediately; the offset
     * eases toward the target across subsequent waitForTimeout() ticks. Models
     * RN ScrollView momentum that continues after pointer-up — the case the
     * synchronous default fake cannot reproduce.
     */
    private readonly momentum = false,
  ) {}

  private queries = 0
  private pendingX = 0
  private pendingY = 0

  async evaluate<T>(): Promise<T> {
    this.queries += 1
    if (this.queryResult) {
      return this.queryResult(this.queries) as T
    }
    return this.elementResult() as T
  }

  private elementResult(): NativeResult<ElementInfo> {
    return {
      success: true,
      data: {
        handle: 'element_0000000000000000',
        testId: 'target',
        text: null,
        role: null,
        label: null,
        bounds: {
          x: this.model.contentX - this.model.offsetX,
          y: this.model.contentY - this.model.offsetY,
          width: this.model.width,
          height: this.model.height,
        },
        visible: true,
        enabled: true,
      },
    }
  }

  async getWindowMetrics(): Promise<WindowMetrics> {
    return METRICS
  }

  async scroll(options: ScrollOptions): Promise<void> {
    this.scrollCalls.push(options)
    if (options.dy !== undefined) {
      const step = clamp(options.dy, -this.model.maxStep, this.model.maxStep)
      if (Math.abs(step) >= this.model.slop) {
        const target = clamp(this.model.offsetY + step, 0, this.model.maxOffsetY)
        if (this.momentum) {
          this.pendingY = target - this.model.offsetY
        } else {
          this.model.offsetY = target
        }
      }
    }
    if (options.dx !== undefined) {
      const step = clamp(options.dx, -this.model.maxStep, this.model.maxStep)
      if (Math.abs(step) >= this.model.slop) {
        const target = clamp(this.model.offsetX + step, 0, this.model.maxOffsetX)
        if (this.momentum) {
          this.pendingX = target - this.model.offsetX
        } else {
          this.model.offsetX = target
        }
      }
    }
  }

  async waitForTimeout(): Promise<void> {
    if (!this.momentum) return
    // Ease toward the target: apply half the remaining delta per tick, snapping
    // when it gets small — the offset keeps moving for a few polls, then settles.
    for (const axis of ['X', 'Y'] as const) {
      const key = `pending${axis}` as const
      const pending = this[key]
      if (pending === 0) continue
      const applied = Math.abs(pending) < 1 ? pending : pending / 2
      if (axis === 'Y') this.model.offsetY += applied
      else this.model.offsetX += applied
      this[key] = pending - applied
    }
  }

  async capabilities(): Promise<Capabilities> {
    return CAPABILITIES
  }

  touchBackendInfo(): TouchBackendInfo | null {
    return {
      selected: 'native-module',
      available: ['native-module'],
    }
  }

  /** Current on-screen bounds, for assertions. */
  boundsY(): number {
    return this.model.contentY - this.model.offsetY
  }
}

function locatorFor(device: FakeDevice): Locator {
  // FakeDevice is structurally compatible with the Locator's Evaluator dep.
  return createLocator(device as never, { type: 'testId', value: 'target' })
}

async function expectLocatorError(promise: Promise<unknown>, code: string): Promise<void> {
  // Single assertion: fails if the promise resolves (no error) OR the rejection
  // isn't a LocatorError with the expected code. Avoids the .catch trap where a
  // resolved promise would skip the code check entirely.
  await expect(promise).rejects.toMatchObject({ name: 'LocatorError', code })
}

describe('Locator.tap', () => {
  const ELEMENT: ElementInfo = {
    handle: 'element_button',
    testId: 'button',
    text: null,
    role: null,
    label: null,
    bounds: { x: 10, y: 20, width: 80, height: 40 },
    visible: true,
    enabled: true,
  }

  function tapDevice(touchBackendInfo: TouchBackendInfo | null): {
    device: Parameters<typeof createLocator>[0]
    tap: ReturnType<typeof vi.fn>
  } {
    const tap = vi.fn(async () => undefined)
    const device = {
      evaluate: async <T>(): Promise<T> => ({ success: true, data: ELEMENT }) as T,
      pointer: { tap },
      waitForTimeout: async () => undefined,
      capabilities: async () => CAPABILITIES_WITHOUT_NATIVE_TOUCH,
      touchBackendInfo: () => touchBackendInfo,
      getWindowMetrics: async () => METRICS,
      scroll: async () => undefined,
      platform: 'android' as const,
    }
    return { device, tap }
  }

  it('allows tap through a selected non-native touch backend when the native module is absent', async () => {
    const { device, tap } = tapDevice(CLI_TOUCH_BACKEND)
    const locator = createLocator(device, { type: 'testId', value: 'button' })

    await locator.tap()

    expect(tap).toHaveBeenCalledWith(50, 40)
  })

  it('throws NOT_SUPPORTED when no touch backend is selected', async () => {
    const { device, tap } = tapDevice(null)
    const locator = createLocator(device, { type: 'testId', value: 'button' })

    await expect(locator.tap()).rejects.toMatchObject({
      name: 'LocatorError',
      code: 'NOT_SUPPORTED',
      message: expect.stringContaining('No touch backend is available'),
    })
    expect(tap).not.toHaveBeenCalled()
  })
})

describe('Locator.scrollIntoView', () => {
  it('does not scroll when the element is already in the viewport', async () => {
    // Element fully on screen (y in [0, 800 - height]).
    const device = new FakeDevice(defaultModel({ contentY: 300 }))
    await locatorFor(device).scrollIntoView()
    expect(device.scrollCalls).toHaveLength(0)
  })

  it('converges on an element below the fold with multiple downward scrolls', async () => {
    const device = new FakeDevice(defaultModel({ contentY: 2000, height: 50, maxStep: 400 }))
    await locatorFor(device).scrollIntoView()

    expect(device.scrollCalls.length).toBeGreaterThan(1)
    for (const call of device.scrollCalls) {
      expect(call.dy ?? 0).toBeGreaterThan(0) // dy > 0 → scroll down
    }
    // Element ended fully inside the viewport.
    expect(device.boundsY()).toBeGreaterThanOrEqual(0)
    expect(device.boundsY() + 50).toBeLessThanOrEqual(METRICS.height)
  })

  it('floors the scroll magnitude so a small residual still clears touch slop', async () => {
    // Regression for the e2e bug: the element sits just below the fold needing a
    // ~10pt scroll, but a swipe that small is below the touch-slop threshold and
    // does not scroll at all → the loop got stuck at the boundary. Flooring the
    // step magnitude makes the final swipe big enough to land it in view.
    // Element bottom at 760 + 50 = 810, viewport 800 → needs ~10pt; slop is 20.
    const device = new FakeDevice(defaultModel({ contentY: 760, height: 50, slop: 20 }))
    await locatorFor(device).scrollIntoView()
    expect(device.boundsY()).toBeGreaterThanOrEqual(0)
    expect(device.boundsY() + 50).toBeLessThanOrEqual(METRICS.height)
  })

  it('converges despite scroll momentum settling after the swipe', async () => {
    // Regression for the e2e bug: a real ScrollView keeps moving after pointer-up,
    // so re-measuring immediately reads an unchanged position and the boundary
    // detector false-fires. With the post-scroll settle, the loop waits for the
    // position to stabilize and converges.
    const device = new FakeDevice(
      defaultModel({ contentY: 2000, height: 50, maxStep: 400 }),
      undefined,
      true, // momentum
    )
    await locatorFor(device).scrollIntoView()
    expect(device.boundsY()).toBeGreaterThanOrEqual(0)
    expect(device.boundsY() + 50).toBeLessThanOrEqual(METRICS.height)
  })

  it('scrolls up to reach an element above the fold', async () => {
    // Element starts scrolled past the top: offsetY > contentY → negative bounds.y.
    const device = new FakeDevice(
      defaultModel({ contentY: 100, offsetY: 600, maxOffsetY: 600, height: 50 }),
    )
    await locatorFor(device).scrollIntoView()

    expect(device.scrollCalls.length).toBeGreaterThan(0)
    for (const call of device.scrollCalls) {
      expect(call.dy ?? 0).toBeLessThan(0) // dy < 0 → scroll up
    }
    expect(device.boundsY()).toBeGreaterThanOrEqual(0)
  })

  it('throws TIMEOUT when the scroll boundary is reached before the element is visible', async () => {
    // Container can only scroll 300pt but the element needs far more.
    const device = new FakeDevice(defaultModel({ contentY: 2000, maxOffsetY: 300, maxStep: 400 }))
    await expectLocatorError(locatorFor(device).scrollIntoView(), 'TIMEOUT')
    // Stopped at the boundary, not after exhausting all maxScrolls.
    expect(device.scrollCalls.length).toBeLessThan(10)
  })

  it('throws TIMEOUT when maxScrolls is exhausted before convergence', async () => {
    // Needs many small steps; cap the attempts low.
    const device = new FakeDevice(defaultModel({ contentY: 5000, maxStep: 100 }))
    await expectLocatorError(locatorFor(device).scrollIntoView({ maxScrolls: 3 }), 'TIMEOUT')
    expect(device.scrollCalls).toHaveLength(3)
  })

  it('blind-scrolls until a not-yet-rendered element appears', async () => {
    const model = defaultModel({ contentY: 300 })
    // First two queries: not found (virtualized). Third: present and in view.
    const device = new FakeDevice(model, (calls) => {
      if (calls < 3) {
        return { success: false, error: 'no element', code: 'NOT_FOUND' }
      }
      return {
        success: true,
        data: {
          handle: 'element_0000000000000000',
          testId: 'target',
          text: null,
          role: null,
          label: null,
          bounds: { x: 0, y: 300, width: 100, height: 50 },
          visible: true,
          enabled: true,
        },
      }
    })

    await locatorFor(device).scrollIntoView()
    expect(device.scrollCalls).toHaveLength(2)
    // Blind scroll defaults to "down".
    for (const call of device.scrollCalls) {
      expect(call.dy ?? 0).toBeGreaterThan(0)
    }
  })

  it('throws NOT_FOUND when the element never appears', async () => {
    const device = new FakeDevice(defaultModel(), () => ({
      success: false,
      error: 'no element',
      code: 'NOT_FOUND',
    }))
    await expectLocatorError(locatorFor(device).scrollIntoView({ maxScrolls: 3 }), 'NOT_FOUND')
    expect(device.scrollCalls).toHaveLength(3)
  })

  it('surfaces NOT_SUPPORTED from the query immediately without scrolling', async () => {
    const device = new FakeDevice(defaultModel(), () => ({
      success: false,
      error: 'view tree module missing',
      code: 'NOT_SUPPORTED',
    }))
    await expectLocatorError(locatorFor(device).scrollIntoView(), 'NOT_SUPPORTED')
    expect(device.scrollCalls).toHaveLength(0)
  })

  it('terminates (does not spin) when off-screen on both axes with neither able to scroll', async () => {
    // Element off-screen right AND below, but both containers are at their limit
    // (maxOffset 0). No progress is possible on either axis.
    const device = new FakeDevice(
      defaultModel({ contentX: 1000, contentY: 1000, maxOffsetX: 0, maxOffsetY: 0 }),
    )
    await expectLocatorError(locatorFor(device).scrollIntoView(), 'TIMEOUT')
    // Boundary detected quickly rather than burning every scroll attempt.
    expect(device.scrollCalls.length).toBeLessThan(10)
  })

  it('scrolls horizontally to reach an off-screen-right element', async () => {
    const device = new FakeDevice(
      defaultModel({ contentX: 1200, contentY: 300, width: 100, height: 50, maxOffsetX: 5000 }),
    )
    await locatorFor(device).scrollIntoView()

    expect(device.scrollCalls.length).toBeGreaterThan(0)
    for (const call of device.scrollCalls) {
      expect(call.dx ?? 0).toBeGreaterThan(0) // dx > 0 → scroll right
    }
  })
})

describe('Locator.fill', () => {
  const ELEMENT: ElementInfo = {
    handle: 'element_field',
    testId: 'field',
    text: null,
    role: null,
    label: null,
    bounds: { x: 0, y: 0, width: 100, height: 40 },
    visible: true,
    enabled: true,
  }

  /**
   * Minimal fake: the query (waitForActionable) resolves an actionable element;
   * the harness fill() call returns a configurable NativeResult.
   */
  function fillDevice(fillResult: NativeResult<unknown>): {
    device: Parameters<typeof createLocator>[0]
    calls: string[]
  } {
    const calls: string[] = []
    const device = {
      evaluate: (async <T>(expr: string): Promise<T> => {
        calls.push(expr)
        if (expr.includes('.fill(')) {
          return fillResult as T
        }
        return { success: true, data: ELEMENT } as T
      }) as <T>(expression: string) => Promise<T>,
      pointer: { tap: async () => undefined },
      waitForTimeout: async () => undefined,
      capabilities: async () => CAPABILITIES,
      touchBackendInfo: (): TouchBackendInfo => ({
        selected: 'native-module',
        available: ['native-module'],
      }),
      getWindowMetrics: async () => METRICS,
      scroll: async () => undefined,
      platform: 'ios' as const,
    }
    return { device, calls }
  }

  it('passes the selector + text to the harness and resolves on success', async () => {
    const { device, calls } = fillDevice({
      success: true,
      data: { onChangeText: true, onChange: false, setNativeProps: true },
    })
    const locator = createLocator(device, { type: 'testId', value: 'field' })

    await locator.fill('hello')

    const fillCall = calls.find((c) => c.includes('.fill('))
    expect(fillCall).toContain('"testId"')
    expect(fillCall).toContain('"hello"')
  })

  it('throws NOT_A_TEXT_INPUT when the harness rejects the target', async () => {
    const { device } = fillDevice({
      success: false,
      error: 'fill() target is not a text input',
      code: 'NOT_A_TEXT_INPUT',
    })
    const locator = createLocator(device, { type: 'testId', value: 'field' })

    await expect(locator.fill('x')).rejects.toMatchObject({ code: 'NOT_A_TEXT_INPUT' })
  })

  it('throws NOT_SUPPORTED when the harness cannot resolve the input', async () => {
    const { device } = fillDevice({
      success: false,
      error: 'could not resolve a TextInput',
      code: 'NOT_SUPPORTED',
    })
    const locator = createLocator(device, { type: 'testId', value: 'field' })

    await expect(locator.fill('x')).rejects.toMatchObject({ code: 'NOT_SUPPORTED' })
  })

  // The harness resolves fill targets by testID only. A non-plain-testId locator
  // would pass the driver-side actionable wait and then have the harness fill the
  // FIRST testID match — a different, wrong element. These guard against that by
  // rejecting BEFORE any dispatch (no `.fill(` call reaches the harness).
  it('rejects a text locator before dispatching', async () => {
    const { device, calls } = fillDevice({ success: true, data: {} })
    const locator = createLocator(device, { type: 'text', value: 'Email', exact: false })

    await expect(locator.fill('x')).rejects.toMatchObject({ code: 'NOT_SUPPORTED' })
    expect(calls.some((c) => c.includes('.fill('))).toBe(false)
  })

  it('rejects a role locator before dispatching', async () => {
    const { device, calls } = fillDevice({ success: true, data: {} })
    const locator = createLocator(device, { type: 'role', value: 'textbox' })

    await expect(locator.fill('x')).rejects.toMatchObject({ code: 'NOT_SUPPORTED' })
    expect(calls.some((c) => c.includes('.fill('))).toBe(false)
  })

  it('rejects an nth() testId locator before dispatching (no silent wrong-target)', async () => {
    const { device, calls } = fillDevice({ success: true, data: {} })
    const locator = createLocator(device, { type: 'testId', value: 'field' }).nth(1)

    await expect(locator.fill('x')).rejects.toMatchObject({ code: 'NOT_SUPPORTED' })
    expect(calls.some((c) => c.includes('.fill('))).toBe(false)
  })

  it('rejects a scoped (within-parent) testId locator before dispatching', async () => {
    const { device, calls } = fillDevice({ success: true, data: {} })
    const scoped = createLocator(device, { type: 'testId', value: 'form' }).getByTestId('field')

    await expect(scoped.fill('x')).rejects.toMatchObject({ code: 'NOT_SUPPORTED' })
    expect(calls.some((c) => c.includes('.fill('))).toBe(false)
  })
})
