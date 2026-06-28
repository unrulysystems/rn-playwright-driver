---
'@unrulysystems/rn-playwright-driver': patch
'@unrulysystems/rn-playwright-driver-runner': minor
'@unrulysystems/rn-playwright-driver-instrumentation-companion': patch
'@unrulysystems/rn-playwright-driver-xctest-companion': patch
'@unrulysystems/rn-driver-lifecycle': patch
'@unrulysystems/rn-driver-touch': patch
'@unrulysystems/rn-driver-screenshot': patch
'@unrulysystems/rn-driver-view-tree': patch
---

Upgrade the dogfood example and native module tooling to Expo SDK 56.

The driver now sends a React Native inspector-compatible WebSocket Origin when
attaching to Hermes CDP, which keeps Expo SDK 56 dev-client debugging connected
on localhost Metro servers. The runner also fast-fails companion readiness when
captured iOS or Android companion logs contain terminal build, test, or
instrumentation failure markers instead of waiting for the full probe timeout.
