# @unrulysystems/rn-playwright-driver

## 0.7.2

### Patch Changes

- [#27](https://github.com/unrulysystems/rn-playwright-driver/pull/27) [`b8eb24e`](https://github.com/unrulysystems/rn-playwright-driver/commit/b8eb24e9daef7f00605fe06dcf520089f62f58be) Thanks [@alleneubank](https://github.com/alleneubank)! - Harden the runner and driver fixtures for dev-client dogfooding.

  The runner now ships a Node-compatible `rn-driver` bin, supports Android
  Expo dev-client deep-link launch, and documents runner-owned lifecycle
  boundaries. The driver Playwright fixture resolves `@playwright/test` from the
  consumer project so npm and Yarn installs use the app's Playwright instance.

## 0.7.1

### Patch Changes

- Refresh the npm package README with companion-backed E2E onboarding guidance.

## 0.7.0

### Minor Changes

- [#19](https://github.com/unrulysystems/rn-playwright-driver/pull/19) [`b74659e`](https://github.com/unrulysystems/rn-playwright-driver/commit/b74659e660437f539cbcf7dbdb5ebcd1b1cb2d0c) Thanks [@alleneubank](https://github.com/alleneubank)! - Cut over touch input confidence paths to platform companions.

  `auto` touch backend selection now fails closed to `xctest` on iOS and
  `instrumentation` on Android. `native-module` and `cli` remain available only
  through explicit `mode: "force"` or explicit backend order configuration.

  The Android instrumentation companion setup now supports token-file auth,
  port configuration, manifest merging, and the example app's companion-backed
  Android e2e script.

  The iOS XCTest companion package now ships scaffold/plugin support, Swift
  companion sources, runtime configuration resources, and the example app's
  companion-backed iOS e2e script.

## 0.6.0

### Minor Changes

- Add release-ready Android touch backend support.
  - Implement the Android adb CLI touch backend and route simple drag/swipe gestures through the faithful single-swipe path.
  - Add Android instrumentation companion auth/config support.
  - Add environment parsing for Android touch backend configuration, including token-file support for local instrumentation scripts.

## 0.5.1

### Patch Changes

- Add the `./package.json` subpath to the package `exports` map so tooling that reads the manifest (e.g. `require('@unrulysystems/rn-playwright-driver/package.json')`) resolves instead of throwing `ERR_PACKAGE_PATH_NOT_EXPORTED`.

## 0.5.0

### Minor Changes

- [`aa1beb2`](https://github.com/unrulysystems/rn-playwright-driver/commit/aa1beb2478afaaac786ad5c99e3a5a01306b2eb4) Thanks [@alleneubank](https://github.com/alleneubank)! - Add `Locator.fill(text)` for text inputs, plus correctness and packaging fixes.
  - **`Locator.fill(text)`** sets a text input's value in one shot, mirrors it onto the native view, and fires a synthetic change so controlled inputs commit to React state — no native keyboard module required. It auto-waits for the input to be actionable and resolves the target by testID only; `nth()`/scoped/`getByRole()`/`getByText()` locators throw `NOT_SUPPORTED` rather than silently filling the wrong input.
  - **Fix:** the published harness now ships its fill resolver as source, so `@0xbigboss/rn-playwright-driver/harness` resolves in installed apps (it previously imported an unpublished `src/` path). A fail-closed import-boundary test guards the published `.ts` surface against re-introducing relative imports into unpublished paths.
  - **Fix:** CDP console/exception forwarders are registered before `Runtime.enable`, closing a connect-window gap where events emitted during attach — including uncaught exceptions surfaced by `failOnUncaughtException` — were dropped.
  - **Fix:** the uncaught-exception buffer is bounded and only retained when `failOnUncaughtException` is enabled, preventing unbounded growth under an exception storm.

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
