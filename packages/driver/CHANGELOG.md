# @0xbigboss/rn-playwright-driver

## 0.4.1

### Patch Changes

- Republish of 0.4.0 with the `@0xbigboss/rn-driver-shared-types` dependency correctly resolved. 0.4.0 was published with `changeset publish` (which delegates to `npm publish` and does not rewrite bun's `workspace:` protocol), so its tarball shipped an uninstallable `"workspace:*"` dependency spec. 0.4.1 is published with `bun publish`, which rewrites the spec to a real version. No source changes from 0.4.0; **0.4.0 is deprecated — use 0.4.1+.**

## 0.4.0

### Minor Changes

- [#8](https://github.com/unrulysystems/rn-playwright-driver/pull/8) [`1fb4220`](https://github.com/unrulysystems/rn-playwright-driver/commit/1fb422097e0d7fe8d6e10e17045cb051487b6384) Thanks [@alleneubank](https://github.com/alleneubank)! - Add a scroll API so tests can reach, assert, and screenshot content below the fold (#7).
  - **`Locator.scrollIntoView(options?)` is now implemented** — previously it threw `LocatorError { code: "NOT_SUPPORTED" }`. It runs a bounded loop that measures the element and issues swipe gestures toward it until it is fully in the viewport. Direction is inferred from the element's measured bounds; for not-yet-rendered (virtualized) content, `options.direction` drives a blind scroll. The loop terminates on success, on the scroll boundary (no-progress detection), or after `options.maxScrolls` (default 10) — it never spins.
  - **New `device.scroll(options)`** — a low-level content-delta scroll performed as a single swipe gesture, with no element target. Anchored at the viewport center by default; the sign convention matches the web `scrollBy` (`dy > 0` scrolls down/reveals below-the-fold content, `dx > 0` scrolls right). Gestures stay within a mid-screen safe band and use a low-momentum motion so the scrolled offset approximates the requested delta.
  - New exported types `ScrollOptions` and `ScrollIntoViewOptions`.

  This removes the need for the previous workarounds (shelling out to an external simulator CLI such as `axe swipe`, or calling `scrollTo` via `device.evaluate()`), and works for both iOS and Android touch backends.

## 0.3.0

### Minor Changes

- 1c9c041: feat(driver): unified gesture API with native touch backend support
  - Add native-module touch backend using @0xbigboss/rn-driver-touch
  - Implement touch backend priority: xctest > native-module > cli > harness
  - Add getTouchBackendInfo() API for backend discovery
  - Add gesture builder with timing, easing, and multi-touch support
  - Add frame delays between pointer events for React state timing
  - Remove harness-backend.ts (replaced by native-module backend)
