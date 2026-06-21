import type {
  Easing,
  ElementBounds,
  Point,
  ScrollOptions,
  SwipeOptions,
  WindowMetrics,
} from "./types";

/**
 * Default gesture duration for a scroll, in ms.
 *
 * Slightly longer than a plain swipe so the motion stays controlled: the
 * `ease-out` profile decelerates into the release, which keeps the velocity at
 * pointer-up low and minimizes ScrollView fling/momentum. That makes the
 * resulting scroll offset track the requested delta far more closely than a
 * fast flick would.
 */
const DEFAULT_SCROLL_DURATION = 400;

/**
 * Default easing for a scroll gesture.
 *
 * `ease-out` decelerates toward the release point → low release velocity → the
 * RN ScrollView barely flings, so the content settles near the requested delta.
 */
const DEFAULT_SCROLL_EASING: Easing = "ease-out";

/**
 * Fraction of the usable (safe-area-adjusted) span trimmed from each edge to
 * form the band the swipe is allowed to touch. Scroll gestures that start or end
 * in the screen-edge gutters are unreliable — they collide with pull-to-refresh,
 * the home-indicator gesture, and navigation edge swipes (AXe's edge-anchored
 * `scroll-down` preset was a no-op on an RN ScrollView for exactly this reason;
 * only a mid-screen swipe moved it). Keeping the whole gesture inside the middle
 * ~80% of the safe span avoids those collisions.
 */
const EDGE_GUTTER_FRACTION = 0.1;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/**
 * One-dimensional swipe segment solver.
 *
 * Given an anchor coordinate and a content-scroll delta, returns the
 * finger-down (`from`) and finger-up (`to`) coordinates for that axis, both
 * guaranteed to lie within `[lo, hi]` (the on-screen safe band).
 *
 * Sign convention: a positive `delta` reveals later content (scroll
 * down/right), which means the finger drags in the NEGATIVE direction, so
 * `to = from - delta`. Matches web `scrollBy`.
 *
 * The gesture length is clamped to the band width (a single physical swipe
 * cannot move further than the screen), then the segment is shifted to fit
 * fully inside the band while preserving that (clamped) length.
 */
function solveAxis(
  anchor: number,
  delta: number,
  lo: number,
  hi: number,
): { from: number; to: number } {
  const span = hi - lo;
  // A single swipe cannot exceed the on-screen band; clamp magnitude, keep sign.
  const d = clamp(delta, -span, span);

  let from = clamp(anchor, lo, hi);
  let to = from - d;

  // Shift the whole segment back inside the band if `to` overflowed. Because
  // |d| <= span, fixing the overflowing end always brings the other end in too.
  if (to < lo) {
    const shift = lo - to;
    from += shift;
    to += shift;
  } else if (to > hi) {
    const shift = hi - to;
    from += shift;
    to += shift;
  }

  return { from, to };
}

/**
 * Compute the on-screen safe band for one axis: the usable span (screen minus
 * safe-area insets) with a fractional gutter trimmed from each edge.
 */
function safeBand(
  start: number,
  end: number,
  insetStart: number,
  insetEnd: number,
): { lo: number; hi: number } {
  const usableStart = start + insetStart;
  const usableEnd = end - insetEnd;
  const usable = Math.max(0, usableEnd - usableStart);
  const gutter = usable * EDGE_GUTTER_FRACTION;
  return { lo: usableStart + gutter, hi: usableEnd - gutter };
}

/**
 * Translate a content-delta scroll request into a concrete swipe gesture.
 *
 * Pure: no I/O, no device access — given the window metrics and options it is
 * fully deterministic, which is what makes the scroll behaviour cheap to test.
 *
 * - Anchors the swipe at the viewport center by default (`options.x`/`options.y`
 *   override).
 * - Maps `dx`/`dy` to finger motion using the web `scrollBy` sign convention
 *   (positive reveals later content; the finger drags the opposite way).
 * - Clamps both endpoints into the mid-screen safe band, so the scroll
 *   magnitude is bounded by the available on-screen swipe distance.
 * - Defaults to a low-momentum motion so the resulting offset approximates the
 *   requested delta rather than flinging past it.
 */
export function computeScrollGesture(metrics: WindowMetrics, options: ScrollOptions): SwipeOptions {
  const dx = options.dx ?? 0;
  const dy = options.dy ?? 0;
  const insets = metrics.safeAreaInsets;

  const bandX = safeBand(0, metrics.width, insets?.left ?? 0, insets?.right ?? 0);
  const bandY = safeBand(0, metrics.height, insets?.top ?? 0, insets?.bottom ?? 0);

  const anchorX = options.x ?? metrics.width / 2;
  const anchorY = options.y ?? metrics.height / 2;

  const axisX = solveAxis(anchorX, dx, bandX.lo, bandX.hi);
  const axisY = solveAxis(anchorY, dy, bandY.lo, bandY.hi);

  const from: Point = { x: axisX.from, y: axisY.from };
  const to: Point = { x: axisX.to, y: axisY.to };

  const swipe: SwipeOptions = {
    from,
    to,
    duration: options.duration ?? DEFAULT_SCROLL_DURATION,
    easing: options.easing ?? DEFAULT_SCROLL_EASING,
  };
  if (options.steps !== undefined) swipe.steps = options.steps;
  if (options.holdStart !== undefined) swipe.holdStart = options.holdStart;
  if (options.holdEnd !== undefined) swipe.holdEnd = options.holdEnd;
  return swipe;
}

/**
 * Sub-pixel tolerance (logical points) for "is the element already in view" and
 * "did the last scroll move it" comparisons. Guards against jitter from
 * floating-point density conversions in the native bounds.
 */
const FIT_EPSILON = 0.5;

/** One step of a `scrollIntoView` loop, derived purely from measured bounds. */
export type ScrollIntoViewStep = {
  /** The element is fully inside the margin-inset viewport; stop scrolling. */
  inView: boolean;
  /** Axis to scroll along this step (the one needing the larger correction). */
  axis: "vertical" | "horizontal";
  /** Content delta ({@link ScrollOptions} sign) to apply along `axis`. */
  delta: number;
  /** Element leading-edge coordinate along `axis`, used for boundary detection. */
  position: number;
};

/**
 * Content delta needed to bring one axis of an element into the margin-inset
 * viewport box `[margin, viewport - margin]`.
 *
 * Returns 0 when already inside. Sign follows {@link ScrollOptions}: positive
 * scrolls forward (down/right), negative scrolls back (up/left). When the
 * element is larger than the box it can't fit fully, so its leading edge is
 * aligned to the box start instead.
 */
function fitAxis(start: number, size: number, viewport: number, margin: number): number {
  const lo = margin;
  const hi = viewport - margin;
  const box = hi - lo;
  const end = start + size;
  if (size >= box) return start - lo; // too big to fit → align leading edge to box start
  if (start < lo) return start - lo; // before the box → scroll back (negative)
  if (end > hi) return end - hi; // past the box → scroll forward (positive)
  return 0;
}

/**
 * Compute the next scroll step to bring `bounds` fully into the viewport.
 *
 * Pure: deterministic from the element bounds + window metrics, so the
 * scroll-into-view convergence logic is unit-testable without a device. The
 * caller (the locator loop) applies `delta` along `axis` via {@link
 * ScrollOptions} and re-measures.
 *
 * Only the axis needing the larger correction is scrolled per step (one clean
 * single-axis swipe at a time); the loop re-measures and handles the other axis
 * on a subsequent step if needed.
 *
 * "In view" means inside the SAFE content area, not the raw screen: an element
 * tucked under the notch / status bar / home indicator is occluded, so the fit
 * box is inset by `metrics.safeAreaInsets`. `margin` adds a further symmetric
 * gap inside that safe box. `position` stays in raw screen coordinates (the
 * constant inset cancels in the delta) so the loop's no-progress detection
 * compares like for like across measurements.
 */
export function computeScrollIntoViewStep(
  bounds: ElementBounds,
  metrics: WindowMetrics,
  margin: number,
): ScrollIntoViewStep {
  const insets = metrics.safeAreaInsets;
  const top = insets?.top ?? 0;
  const bottom = insets?.bottom ?? 0;
  const left = insets?.left ?? 0;
  const right = insets?.right ?? 0;

  const dy = fitAxis(bounds.y - top, bounds.height, metrics.height - top - bottom, margin);
  const dx = fitAxis(bounds.x - left, bounds.width, metrics.width - left - right, margin);
  const inView = Math.abs(dx) < FIT_EPSILON && Math.abs(dy) < FIT_EPSILON;
  const vertical = Math.abs(dy) >= Math.abs(dx);
  return {
    inView,
    axis: vertical ? "vertical" : "horizontal",
    delta: vertical ? dy : dx,
    position: vertical ? bounds.y : bounds.x,
  };
}

/** True when two axis positions are equal within the fit tolerance. */
export function isSamePosition(a: number, b: number): boolean {
  return Math.abs(a - b) < FIT_EPSILON;
}

/**
 * Blind scroll request for a cardinal direction, used by `scrollIntoView` when
 * the element isn't yet in the view tree (so its position can't be measured to
 * infer direction). Magnitude is one viewport span; {@link computeScrollGesture}
 * clamps it to the on-screen safe band.
 */
export function scrollForDirection(
  direction: "up" | "down" | "left" | "right",
  metrics: WindowMetrics,
): ScrollOptions {
  switch (direction) {
    case "down":
      return { dy: metrics.height };
    case "up":
      return { dy: -metrics.height };
    case "right":
      return { dx: metrics.width };
    case "left":
      return { dx: -metrics.width };
    default: {
      const _exhaustive: never = direction;
      throw new Error(`Unknown scroll direction: ${_exhaustive}`);
    }
  }
}
