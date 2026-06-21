/**
 * Tests for the pure scroll-gesture geometry (computeScrollGesture).
 */

import { describe, expect, it } from "vitest";
import { computeScrollGesture } from "./scroll";
import type { WindowMetrics } from "./types";

function metrics(overrides: Partial<WindowMetrics> = {}): WindowMetrics {
  return {
    width: 400,
    height: 800,
    pixelRatio: 2,
    scale: 2,
    fontScale: 1,
    orientation: "portrait",
    ...overrides,
  };
}

// With width=400/height=800 and no insets, the 10% edge gutter yields:
//   band X = [40, 360] (span 320), band Y = [80, 720] (span 640)
// anchored at the viewport center (200, 400).
const BAND_X = { lo: 40, hi: 360 };
const BAND_Y = { lo: 80, hi: 720 };

describe("computeScrollGesture", () => {
  it("anchors at the viewport center by default", () => {
    const g = computeScrollGesture(metrics(), { dy: 100 });
    expect(g.from.x).toBe(200);
    expect(g.from.y).toBe(400);
  });

  it("dy > 0 (scroll down) drags the finger up", () => {
    const g = computeScrollGesture(metrics(), { dy: 200 });
    expect(g.to.y).toBeLessThan(g.from.y);
    expect(g.from.y - g.to.y).toBe(200);
    expect(g.from.x).toBe(g.to.x); // no horizontal movement
  });

  it("dy < 0 (scroll up) drags the finger down", () => {
    const g = computeScrollGesture(metrics(), { dy: -200 });
    expect(g.to.y).toBeGreaterThan(g.from.y);
    expect(g.to.y - g.from.y).toBe(200);
  });

  it("dx > 0 (scroll right) drags the finger left", () => {
    const g = computeScrollGesture(metrics(), { dx: 100 });
    expect(g.to.x).toBeLessThan(g.from.x);
    expect(g.from.x - g.to.x).toBe(100);
    expect(g.from.y).toBe(g.to.y); // no vertical movement
  });

  it("honors a custom anchor that lies inside the safe band", () => {
    const g = computeScrollGesture(metrics(), { x: 150, y: 300, dy: 100 });
    expect(g.from).toEqual({ x: 150, y: 300 });
    expect(g.to).toEqual({ x: 150, y: 200 });
  });

  it("clamps an oversized delta and keeps both endpoints in the safe band", () => {
    const g = computeScrollGesture(metrics(), { dy: 2000 });
    // Magnitude clamped to the vertical band span (640); still scrolls down.
    expect(g.to.y).toBeLessThan(g.from.y);
    expect(g.from.y - g.to.y).toBe(BAND_Y.hi - BAND_Y.lo);
    for (const p of [g.from, g.to]) {
      expect(p.y).toBeGreaterThanOrEqual(BAND_Y.lo);
      expect(p.y).toBeLessThanOrEqual(BAND_Y.hi);
    }
  });

  it("keeps horizontal endpoints in the safe band for an oversized dx", () => {
    const g = computeScrollGesture(metrics(), { dx: 5000 });
    expect(g.from.x - g.to.x).toBe(BAND_X.hi - BAND_X.lo);
    for (const p of [g.from, g.to]) {
      expect(p.x).toBeGreaterThanOrEqual(BAND_X.lo);
      expect(p.x).toBeLessThanOrEqual(BAND_X.hi);
    }
  });

  it("respects safe-area insets when forming the band", () => {
    const g = computeScrollGesture(
      metrics({ safeAreaInsets: { top: 100, bottom: 50, left: 0, right: 0 } }),
      { dy: 100 },
    );
    // usable Y = [100, 750], gutter = 65 → band = [165, 685].
    for (const p of [g.from, g.to]) {
      expect(p.y).toBeGreaterThanOrEqual(165);
      expect(p.y).toBeLessThanOrEqual(685);
    }
  });

  it("applies low-momentum defaults (ease-out, 400ms)", () => {
    const g = computeScrollGesture(metrics(), { dy: 100 });
    expect(g.duration).toBe(400);
    expect(g.easing).toBe("ease-out");
  });

  it("passes through caller-supplied motion options", () => {
    const g = computeScrollGesture(metrics(), {
      dy: 100,
      duration: 1000,
      easing: "linear",
      steps: 5,
      holdStart: 50,
      holdEnd: 25,
    });
    expect(g.duration).toBe(1000);
    expect(g.easing).toBe("linear");
    expect(g.steps).toBe(5);
    expect(g.holdStart).toBe(50);
    expect(g.holdEnd).toBe(25);
  });

  it("produces a no-op segment when no delta is given", () => {
    const g = computeScrollGesture(metrics(), {});
    expect(g.from).toEqual(g.to);
  });
});
