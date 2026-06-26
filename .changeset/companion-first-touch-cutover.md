---
'@unrulysystems/rn-playwright-driver': minor
'@unrulysystems/rn-playwright-driver-xctest-companion': minor
'@unrulysystems/rn-playwright-driver-instrumentation-companion': minor
---

Cut over touch input confidence paths to platform companions.

`auto` touch backend selection now fails closed to `xctest` on iOS and
`instrumentation` on Android. `native-module` and `cli` remain available only
through explicit `mode: "force"` or explicit backend order configuration.

The Android instrumentation companion setup now supports token-file auth,
port configuration, manifest merging, and the example app's companion-backed
Android e2e script.

The iOS XCTest companion package now ships scaffold/plugin support, Swift
companion sources, runtime configuration resources, and the example app's
companion-backed iOS e2e script.
