/**
 * Tests for the pure scroll-gesture geometry (computeScrollGesture).
 */

import { describe, expect, it } from 'vitest'
import { computeScrollGesture, computeScrollIntoViewStep, scrollForDirection } from './scroll'
import type { ElementBounds, WindowMetrics } from './types'

function metrics(overrides: Partial<WindowMetrics> = {}): WindowMetrics {
  return {
    width: 400,
    height: 800,
    pixelRatio: 2,
    scale: 2,
    fontScale: 1,
    orientation: 'portrait',
    ...overrides,
  }
}

// With width=400/height=800 and no insets, the 10% edge gutter yields:
//   band X = [40, 360] (span 320), band Y = [80, 720] (span 640)
// anchored at the viewport center (200, 400).
const BAND_X = { lo: 40, hi: 360 }
const BAND_Y = { lo: 80, hi: 720 }

describe('computeScrollGesture', () => {
  it('anchors at the viewport center by default', () => {
    const g = computeScrollGesture(metrics(), { dy: 100 })
    expect(g.from.x).toBe(200)
    expect(g.from.y).toBe(400)
  })

  it('dy > 0 (scroll down) drags the finger up', () => {
    const g = computeScrollGesture(metrics(), { dy: 200 })
    expect(g.to.y).toBeLessThan(g.from.y)
    expect(g.from.y - g.to.y).toBe(200)
    expect(g.from.x).toBe(g.to.x) // no horizontal movement
  })

  it('dy < 0 (scroll up) drags the finger down', () => {
    const g = computeScrollGesture(metrics(), { dy: -200 })
    expect(g.to.y).toBeGreaterThan(g.from.y)
    expect(g.to.y - g.from.y).toBe(200)
  })

  it('dx > 0 (scroll right) drags the finger left', () => {
    const g = computeScrollGesture(metrics(), { dx: 100 })
    expect(g.to.x).toBeLessThan(g.from.x)
    expect(g.from.x - g.to.x).toBe(100)
    expect(g.from.y).toBe(g.to.y) // no vertical movement
  })

  it('honors a custom anchor that lies inside the safe band', () => {
    const g = computeScrollGesture(metrics(), { x: 150, y: 300, dy: 100 })
    expect(g.from).toEqual({ x: 150, y: 300 })
    expect(g.to).toEqual({ x: 150, y: 200 })
  })

  it('clamps an oversized delta and keeps both endpoints in the safe band', () => {
    const g = computeScrollGesture(metrics(), { dy: 2000 })
    // Magnitude clamped to the vertical band span (640); still scrolls down.
    expect(g.to.y).toBeLessThan(g.from.y)
    expect(g.from.y - g.to.y).toBe(BAND_Y.hi - BAND_Y.lo)
    for (const p of [g.from, g.to]) {
      expect(p.y).toBeGreaterThanOrEqual(BAND_Y.lo)
      expect(p.y).toBeLessThanOrEqual(BAND_Y.hi)
    }
  })

  it('keeps horizontal endpoints in the safe band for an oversized dx', () => {
    const g = computeScrollGesture(metrics(), { dx: 5000 })
    expect(g.from.x - g.to.x).toBe(BAND_X.hi - BAND_X.lo)
    for (const p of [g.from, g.to]) {
      expect(p.x).toBeGreaterThanOrEqual(BAND_X.lo)
      expect(p.x).toBeLessThanOrEqual(BAND_X.hi)
    }
  })

  it('respects safe-area insets when forming the band', () => {
    const g = computeScrollGesture(
      metrics({ safeAreaInsets: { top: 100, bottom: 50, left: 0, right: 0 } }),
      { dy: 100 },
    )
    // usable Y = [100, 750], gutter = 65 → band = [165, 685].
    for (const p of [g.from, g.to]) {
      expect(p.y).toBeGreaterThanOrEqual(165)
      expect(p.y).toBeLessThanOrEqual(685)
    }
  })

  it('applies low-momentum defaults (ease-out, 400ms)', () => {
    const g = computeScrollGesture(metrics(), { dy: 100 })
    expect(g.duration).toBe(400)
    expect(g.easing).toBe('ease-out')
  })

  it('passes through caller-supplied motion options', () => {
    const g = computeScrollGesture(metrics(), {
      dy: 100,
      duration: 1000,
      easing: 'linear',
      steps: 5,
      holdStart: 50,
      holdEnd: 25,
    })
    expect(g.duration).toBe(1000)
    expect(g.easing).toBe('linear')
    expect(g.steps).toBe(5)
    expect(g.holdStart).toBe(50)
    expect(g.holdEnd).toBe(25)
  })

  it('produces a no-op segment when no delta is given', () => {
    const g = computeScrollGesture(metrics(), {})
    expect(g.from).toEqual(g.to)
  })
})

function bounds(overrides: Partial<ElementBounds> = {}): ElementBounds {
  return { x: 0, y: 0, width: 100, height: 50, ...overrides }
}

describe('computeScrollIntoViewStep', () => {
  // Viewport 400x800, margin 0.
  it('reports inView for an element fully inside the viewport', () => {
    const step = computeScrollIntoViewStep(bounds({ x: 50, y: 300 }), metrics(), 0)
    expect(step.inView).toBe(true)
  })

  it('returns a positive vertical delta for an element below the fold', () => {
    const step = computeScrollIntoViewStep(bounds({ y: 1000, height: 50 }), metrics(), 0)
    expect(step.axis).toBe('vertical')
    expect(step.delta).toBeGreaterThan(0) // scroll down
    expect(step.inView).toBe(false)
    expect(step.position).toBe(1000)
  })

  it('returns a negative vertical delta for an element above the fold', () => {
    const step = computeScrollIntoViewStep(bounds({ y: -200, height: 50 }), metrics(), 0)
    expect(step.delta).toBeLessThan(0) // scroll up
  })

  it('prefers the horizontal axis when the off-screen-right correction is larger', () => {
    const step = computeScrollIntoViewStep(bounds({ x: 1000, y: 300, width: 100 }), metrics(), 0)
    expect(step.axis).toBe('horizontal')
    expect(step.delta).toBeGreaterThan(0) // scroll right
    expect(step.position).toBe(1000)
  })

  it('honors margin when deciding the delta', () => {
    // x=100 keeps the horizontal axis inside the margin box so only the
    // vertical correction matters. Element bottom at 760; with margin 50 the box
    // bottom is 750, so it must scroll down 10 to clear the bottom margin.
    const step = computeScrollIntoViewStep(bounds({ x: 100, y: 710, height: 50 }), metrics(), 50)
    expect(step.axis).toBe('vertical')
    expect(step.delta).toBeCloseTo(10)
  })

  it('aligns the leading edge for an element taller than the viewport box', () => {
    // height 900 > 800: cannot fit; align its top to the box top (delta brings y→0).
    const step = computeScrollIntoViewStep(bounds({ y: 100, height: 900 }), metrics(), 0)
    expect(step.delta).toBeCloseTo(100)
    const aligned = computeScrollIntoViewStep(bounds({ y: 0, height: 900 }), metrics(), 0)
    expect(aligned.inView).toBe(true)
  })

  it('treats an element under a safe-area inset as not in view', () => {
    // home indicator: bottom inset 34. Safe content bottom is 800 - 34 = 766.
    const m = metrics({ safeAreaInsets: { top: 44, bottom: 34, left: 0, right: 0 } })
    const occluded = bounds({ x: 100, y: 750, height: 50 }) // bottom at 800, behind indicator
    const step = computeScrollIntoViewStep(occluded, m, 0)
    expect(step.inView).toBe(false)
    expect(step.axis).toBe('vertical')
    // Must scroll down enough to lift the element fully above the inset (766 - 800 = -34).
    expect(step.delta).toBeCloseTo(34)

    // Same element fully within the safe area reads as in view.
    const safe = computeScrollIntoViewStep(bounds({ x: 100, y: 400, height: 50 }), m, 0)
    expect(safe.inView).toBe(true)
  })
})

describe('scrollForDirection', () => {
  it('maps cardinal directions to one-viewport content deltas', () => {
    const m = metrics()
    expect(scrollForDirection('down', m)).toEqual({ dy: m.height })
    expect(scrollForDirection('up', m)).toEqual({ dy: -m.height })
    expect(scrollForDirection('right', m)).toEqual({ dx: m.width })
    expect(scrollForDirection('left', m)).toEqual({ dx: -m.width })
  })
})
