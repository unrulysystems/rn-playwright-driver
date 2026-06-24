---
"@0xbigboss/rn-playwright-driver": minor
---

Add `Locator.fill(text)` for text inputs, plus correctness and packaging fixes.

- **`Locator.fill(text)`** sets a text input's value in one shot, mirrors it onto the native view, and fires a synthetic change so controlled inputs commit to React state — no native keyboard module required. It auto-waits for the input to be actionable and resolves the target by testID only; `nth()`/scoped/`getByRole()`/`getByText()` locators throw `NOT_SUPPORTED` rather than silently filling the wrong input.
- **Fix:** the published harness now ships its fill resolver as source, so `@0xbigboss/rn-playwright-driver/harness` resolves in installed apps (it previously imported an unpublished `src/` path). A fail-closed import-boundary test guards the published `.ts` surface against re-introducing relative imports into unpublished paths.
- **Fix:** CDP console/exception forwarders are registered before `Runtime.enable`, closing a connect-window gap where events emitted during attach — including uncaught exceptions surfaced by `failOnUncaughtException` — were dropped.
- **Fix:** the uncaught-exception buffer is bounded and only retained when `failOnUncaughtException` is enabled, preventing unbounded growth under an exception storm.
