---
'@unrulysystems/rn-playwright-driver-runner': patch
---

`--dry-run` now says when it has not resolved `--device`. REQ-CLI-002 keeps that path free of device I/O so it runs offline on a machine with no Xcode or Android SDK, which means a `--device` naming nothing still exits 0 with a plausible plan — and the runner README called that output "the resolved plan" while the example app documented `--dry-run` as the pre-flight to run first, so a typo read as a passing check. The flag table, the pipeline diagram, the root README and the example README now state that device resolution happens only in a real run, and the plan prints an explicit note when `--device` is passed.
