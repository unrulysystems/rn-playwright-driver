---
'@unrulysystems/rn-playwright-driver-runner': minor
---

`rn-driver test` now refuses a runtime without the global `WebSocket`/`fetch` its readiness probes need (Node < 22 without bun) at stage `config`, before prebuild and the native build, instead of failing at the companion stage twenty minutes in. `--dry-run` still runs anywhere (REQ-CLI-008).
