---
"@0xbigboss/rn-playwright-driver": minor
---

Add a scroll API so tests can reach, assert, and screenshot content below the fold (#7).

- **`Locator.scrollIntoView(options?)` is now implemented** — previously it threw `LocatorError { code: "NOT_SUPPORTED" }`. It runs a bounded loop that measures the element and issues swipe gestures toward it until it is fully in the viewport. Direction is inferred from the element's measured bounds; for not-yet-rendered (virtualized) content, `options.direction` drives a blind scroll. The loop terminates on success, on the scroll boundary (no-progress detection), or after `options.maxScrolls` (default 10) — it never spins.
- **New `device.scroll(options)`** — a low-level content-delta scroll performed as a single swipe gesture, with no element target. Anchored at the viewport center by default; the sign convention matches the web `scrollBy` (`dy > 0` scrolls down/reveals below-the-fold content, `dx > 0` scrolls right). Gestures stay within a mid-screen safe band and use a low-momentum motion so the scrolled offset approximates the requested delta.
- New exported types `ScrollOptions` and `ScrollIntoViewOptions`.

This removes the need for the previous workarounds (shelling out to an external simulator CLI such as `axe swipe`, or calling `scrollTo` via `device.evaluate()`), and works for both iOS and Android touch backends.
