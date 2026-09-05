---
'@unrulysystems/rn-playwright-driver-runner': minor
---

The iOS plan gains an `ios.install-app` step: after the build, the runner asks `xcodebuild -showBuildSettings` for the application product and installs it with `simctl install` (or `devicectl device install app`). XCTest only installs the app under test when the companion launches it, so `attach` mode on a fresh simulator used to fail at `simctl launch` with "not installed" (REQ-IOS-015).
