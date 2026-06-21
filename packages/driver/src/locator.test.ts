/**
 * Tests for Locator.scrollIntoView() against a simulated scrollable viewport.
 *
 * The fake device models a scroll container: the element sits at a fixed
 * position in content space, and `scroll()` advances a bounded scroll offset
 * (clamped per-gesture and by the container's content length), so the loop's
 * convergence, boundary detection, and not-found handling can be exercised
 * without a real device.
 */

import type { ElementInfo, NativeResult } from "@0xbigboss/rn-driver-shared-types";
import { describe, expect, it } from "vitest";
import { createLocator, type Locator } from "./locator";
import type { Capabilities, ScrollOptions, WindowMetrics } from "./types";

const METRICS: WindowMetrics = {
  width: 400,
  height: 800,
  pixelRatio: 2,
  scale: 2,
  fontScale: 1,
  orientation: "portrait",
};

const CAPABILITIES: Capabilities = {
  apiVersion: 1,
  viewTree: true,
  viewTreeTap: true,
  screenshot: true,
  screenshotCaptureElement: true,
  lifecycle: true,
  touchNative: true,
};

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

type ScrollModel = {
  /** Fixed element position in content space. */
  contentX: number;
  contentY: number;
  width: number;
  height: number;
  /** Current scroll offset (content scrolled out of the top/left). */
  offsetX: number;
  offsetY: number;
  /** Max scroll offset = content length beyond the viewport. */
  maxOffsetX: number;
  maxOffsetY: number;
  /** Per-gesture movement cap, modeling the on-screen swipe band. */
  maxStep: number;
};

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
    ...overrides,
  };
}

/** A fake device implementing the structural shape the Locator needs. */
class FakeDevice {
  readonly platform = "ios" as const;
  readonly scrollCalls: ScrollOptions[] = [];
  readonly pointer = { tap: async () => {} };

  constructor(
    private readonly model: ScrollModel,
    /** Optional override to simulate query failures / virtualization. */
    private readonly queryResult?: (calls: number) => NativeResult<ElementInfo>,
  ) {}

  private queries = 0;

  async evaluate<T>(): Promise<T> {
    this.queries += 1;
    if (this.queryResult) {
      return this.queryResult(this.queries) as T;
    }
    return this.elementResult() as T;
  }

  private elementResult(): NativeResult<ElementInfo> {
    return {
      success: true,
      data: {
        handle: "element_0000000000000000",
        testId: "target",
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
    };
  }

  async getWindowMetrics(): Promise<WindowMetrics> {
    return METRICS;
  }

  async scroll(options: ScrollOptions): Promise<void> {
    this.scrollCalls.push(options);
    if (options.dy !== undefined) {
      const step = clamp(options.dy, -this.model.maxStep, this.model.maxStep);
      this.model.offsetY = clamp(this.model.offsetY + step, 0, this.model.maxOffsetY);
    }
    if (options.dx !== undefined) {
      const step = clamp(options.dx, -this.model.maxStep, this.model.maxStep);
      this.model.offsetX = clamp(this.model.offsetX + step, 0, this.model.maxOffsetX);
    }
  }

  async waitForTimeout(): Promise<void> {}

  async capabilities(): Promise<Capabilities> {
    return CAPABILITIES;
  }

  /** Current on-screen bounds, for assertions. */
  boundsY(): number {
    return this.model.contentY - this.model.offsetY;
  }
}

function locatorFor(device: FakeDevice): Locator {
  // FakeDevice is structurally compatible with the Locator's Evaluator dep.
  return createLocator(device as never, { type: "testId", value: "target" });
}

async function expectLocatorError(promise: Promise<unknown>, code: string): Promise<void> {
  // Single assertion: fails if the promise resolves (no error) OR the rejection
  // isn't a LocatorError with the expected code. Avoids the .catch trap where a
  // resolved promise would skip the code check entirely.
  await expect(promise).rejects.toMatchObject({ name: "LocatorError", code });
}

describe("Locator.scrollIntoView", () => {
  it("does not scroll when the element is already in the viewport", async () => {
    // Element fully on screen (y in [0, 800 - height]).
    const device = new FakeDevice(defaultModel({ contentY: 300 }));
    await locatorFor(device).scrollIntoView();
    expect(device.scrollCalls).toHaveLength(0);
  });

  it("converges on an element below the fold with multiple downward scrolls", async () => {
    const device = new FakeDevice(defaultModel({ contentY: 2000, height: 50, maxStep: 400 }));
    await locatorFor(device).scrollIntoView();

    expect(device.scrollCalls.length).toBeGreaterThan(1);
    for (const call of device.scrollCalls) {
      expect(call.dy ?? 0).toBeGreaterThan(0); // dy > 0 → scroll down
    }
    // Element ended fully inside the viewport.
    expect(device.boundsY()).toBeGreaterThanOrEqual(0);
    expect(device.boundsY() + 50).toBeLessThanOrEqual(METRICS.height);
  });

  it("scrolls up to reach an element above the fold", async () => {
    // Element starts scrolled past the top: offsetY > contentY → negative bounds.y.
    const device = new FakeDevice(
      defaultModel({ contentY: 100, offsetY: 600, maxOffsetY: 600, height: 50 }),
    );
    await locatorFor(device).scrollIntoView();

    expect(device.scrollCalls.length).toBeGreaterThan(0);
    for (const call of device.scrollCalls) {
      expect(call.dy ?? 0).toBeLessThan(0); // dy < 0 → scroll up
    }
    expect(device.boundsY()).toBeGreaterThanOrEqual(0);
  });

  it("throws TIMEOUT when the scroll boundary is reached before the element is visible", async () => {
    // Container can only scroll 300pt but the element needs far more.
    const device = new FakeDevice(defaultModel({ contentY: 2000, maxOffsetY: 300, maxStep: 400 }));
    await expectLocatorError(locatorFor(device).scrollIntoView(), "TIMEOUT");
    // Stopped at the boundary, not after exhausting all maxScrolls.
    expect(device.scrollCalls.length).toBeLessThan(10);
  });

  it("throws TIMEOUT when maxScrolls is exhausted before convergence", async () => {
    // Needs many small steps; cap the attempts low.
    const device = new FakeDevice(defaultModel({ contentY: 5000, maxStep: 100 }));
    await expectLocatorError(locatorFor(device).scrollIntoView({ maxScrolls: 3 }), "TIMEOUT");
    expect(device.scrollCalls).toHaveLength(3);
  });

  it("blind-scrolls until a not-yet-rendered element appears", async () => {
    const model = defaultModel({ contentY: 300 });
    // First two queries: not found (virtualized). Third: present and in view.
    const device = new FakeDevice(model, (calls) => {
      if (calls < 3) {
        return { success: false, error: "no element", code: "NOT_FOUND" };
      }
      return {
        success: true,
        data: {
          handle: "element_0000000000000000",
          testId: "target",
          text: null,
          role: null,
          label: null,
          bounds: { x: 0, y: 300, width: 100, height: 50 },
          visible: true,
          enabled: true,
        },
      };
    });

    await locatorFor(device).scrollIntoView();
    expect(device.scrollCalls).toHaveLength(2);
    // Blind scroll defaults to "down".
    for (const call of device.scrollCalls) {
      expect(call.dy ?? 0).toBeGreaterThan(0);
    }
  });

  it("throws NOT_FOUND when the element never appears", async () => {
    const device = new FakeDevice(defaultModel(), () => ({
      success: false,
      error: "no element",
      code: "NOT_FOUND",
    }));
    await expectLocatorError(locatorFor(device).scrollIntoView({ maxScrolls: 3 }), "NOT_FOUND");
    expect(device.scrollCalls).toHaveLength(3);
  });

  it("surfaces NOT_SUPPORTED from the query immediately without scrolling", async () => {
    const device = new FakeDevice(defaultModel(), () => ({
      success: false,
      error: "view tree module missing",
      code: "NOT_SUPPORTED",
    }));
    await expectLocatorError(locatorFor(device).scrollIntoView(), "NOT_SUPPORTED");
    expect(device.scrollCalls).toHaveLength(0);
  });

  it("terminates (does not spin) when off-screen on both axes with neither able to scroll", async () => {
    // Element off-screen right AND below, but both containers are at their limit
    // (maxOffset 0). No progress is possible on either axis.
    const device = new FakeDevice(
      defaultModel({ contentX: 1000, contentY: 1000, maxOffsetX: 0, maxOffsetY: 0 }),
    );
    await expectLocatorError(locatorFor(device).scrollIntoView(), "TIMEOUT");
    // Boundary detected quickly rather than burning every scroll attempt.
    expect(device.scrollCalls.length).toBeLessThan(10);
  });

  it("scrolls horizontally to reach an off-screen-right element", async () => {
    const device = new FakeDevice(
      defaultModel({ contentX: 1200, contentY: 300, width: 100, height: 50, maxOffsetX: 5000 }),
    );
    await locatorFor(device).scrollIntoView();

    expect(device.scrollCalls.length).toBeGreaterThan(0);
    for (const call of device.scrollCalls) {
      expect(call.dx ?? 0).toBeGreaterThan(0); // dx > 0 → scroll right
    }
  });
});
