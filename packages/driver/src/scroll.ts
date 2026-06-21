import type { Easing, Point, ScrollOptions, SwipeOptions, WindowMetrics } from "./types";

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
