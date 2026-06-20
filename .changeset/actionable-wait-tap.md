---
"@0xbigboss/rn-playwright-driver": minor
---

Actionable-wait `tap()` and capability versioning.

- **`tap()` now auto-waits for the element to be visible and enabled** before dispatching the touch (`Locator.waitForActionable()`), instead of resolving the locator once with no retry. Consumers racing taps against post-navigation re-renders no longer need an external wait-for-visible-then-tap wrapper.
- Add capability versioning: the harness reports `capabilities.apiVersion` for capability negotiation.
- **Breaking (harness):** removed the standalone harness version string; the harness now reports its API version via `capabilities.apiVersion`. Apps importing `@0xbigboss/rn-playwright-driver/harness` should rebuild against the new harness.
- fix(cdp): assert the `awaitPromise` probe's resolved value rather than treating any non-exception as success.
