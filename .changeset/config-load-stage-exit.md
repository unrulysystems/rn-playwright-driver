---
'@unrulysystems/rn-playwright-driver-runner': patch
---

A config the loader cannot parse now fails at stage `config` with the stage's exit code instead of escaping to Node's default handler, which printed an internal stack and exited 1 — Playwright's own code, so an unparseable config was indistinguishable from a failing test run and named no stage, against REQ-CLI-006 and REQ-DIAG-001. Config files that parse were already handled; only the throw path was missing.
