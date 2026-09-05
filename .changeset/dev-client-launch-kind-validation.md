---
'@unrulysystems/rn-playwright-driver-runner': minor
---

Validate `launch.kind` against the app package (REQ-CFG-006): when `expo-dev-client` is a dependency of the package next to `rn-driver.config`, a selected platform configured `kind: 'plain'` now fails config validation with the dev-client fix, instead of surfacing sixty seconds later as a `hermes-target` timeout on a fresh simulator or emulator. `validateConfig`/`assertValid` accept an optional `ProjectContext`; `readProjectContext(dir)` builds one from `package.json`.
