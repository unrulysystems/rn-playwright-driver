# Release Finish-Line Checklist

This checklist reflects the current source state and avoids older claims about a JS harness touch backend or `RN_TOUCH_BACKEND` fixture parsing.

## Source State Verified

- [x] `@unrulysystems/rn-playwright-driver` exports the CDP driver, Playwright fixture, harness, locators, assertions, pointer APIs, and typed touch backends.
- [x] `@unrulysystems/rn-driver-view-tree` includes iOS and Android Expo modules for testID/text/role queries, bounds, visibility, enabled state, refresh, and best-effort native tap.
- [x] `@unrulysystems/rn-driver-screenshot` includes iOS and Android Expo modules for full-screen, element, and region capture.
- [x] `@unrulysystems/rn-driver-lifecycle` includes iOS and Android Expo modules, with partial platform parity: iOS reload/background are `NOT_SUPPORTED`, Android implements reload/background/foreground best effort.
- [x] `@unrulysystems/rn-driver-touch` includes iOS and Android Expo modules. iOS is DEBUG-only; Android requires Instrumentation availability.
- [x] XCTest and Android Instrumentation companion clients exist in the driver, with reference companion packages that require manual integration.
- [x] `CliTouchBackend` has an Android adb implementation; iOS idb support is still not implemented.
- [x] The R3F binding (`TestBridge`, `hitTest`, `dispatchPointer`, locators, helpers, fixture wrappers) was moved out of this repo into the Scenic monorepo (`@unrulysystems/scenic-three` + `@unrulysystems/scenic-native`); the driver stays renderer-agnostic.

## Release Blockers

- [ ] Add targeted package tests for touch backend selection defaults and failure diagnostics.
- [x] Implement fixture env parsing for `RN_TOUCH_BACKEND` and `RN_TOUCH_INSTRUMENTATION_PORT`.
- [ ] Add device-backed smoke coverage for `@unrulysystems/rn-driver-touch` on iOS DEBUG and Android Instrumentation.
- [ ] Document the Android native-module launch requirement: plain app launches do not provide `Instrumentation`.
- [ ] Decide companion package publishing scope: reference source only, or package scripts that start/attach companions.
- [ ] Run `nub run check` at repo root after the above changes.

## Explicit Non-Goals For This Release

- No JS harness touch fallback.
- No automatic idb CLI fallback.
- No R3F code in `@unrulysystems/rn-playwright-driver`.
- No broad renderer or game-specific integration in the driver repo.
