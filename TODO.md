# Release Finish-Line Checklist

This checklist reflects the current source state and avoids older claims about a JS harness touch backend or `RN_TOUCH_BACKEND` fixture parsing.

## Source State Verified

- [x] `@0xbigboss/rn-playwright-driver` exports the CDP driver, Playwright fixture, harness, locators, assertions, pointer APIs, and typed touch backends.
- [x] `@0xbigboss/rn-driver-view-tree` includes iOS and Android Expo modules for testID/text/role queries, bounds, visibility, enabled state, refresh, and best-effort native tap.
- [x] `@0xbigboss/rn-driver-screenshot` includes iOS and Android Expo modules for full-screen, element, and region capture.
- [x] `@0xbigboss/rn-driver-lifecycle` includes iOS and Android Expo modules, with partial platform parity: iOS reload/background are `NOT_SUPPORTED`, Android implements reload/background/foreground best effort.
- [x] `@0xbigboss/rn-driver-touch` includes iOS and Android Expo modules. iOS is DEBUG-only; Android requires Instrumentation availability.
- [x] XCTest and Android Instrumentation companion clients exist in the driver, with reference companion packages that require manual integration.
- [x] `CliTouchBackend` is a stub and is not a working fallback.
- [x] The R3F binding (`TestBridge`, `hitTest`, `dispatchPointer`, locators, helpers, fixture wrappers) was moved out of this repo into the Scenic monorepo (`@unrulysystems/scenic-three` + `@unrulysystems/scenic-native`); the driver stays renderer-agnostic.

## Release Blockers

- [ ] Add targeted package tests for touch backend selection defaults and failure diagnostics.
- [ ] Decide whether to implement fixture env parsing for `RN_TOUCH_BACKEND`; until then, document `DeviceOptions.touch` as the only supported configuration path.
- [ ] Add device-backed smoke coverage for `@0xbigboss/rn-driver-touch` on iOS DEBUG and Android Instrumentation.
- [ ] Document the Android native-module launch requirement: plain app launches do not provide `Instrumentation`.
- [ ] Decide companion package publishing scope: reference source only, or package scripts that start/attach companions.
- [ ] Run `bun run check` at repo root after the above changes.

## Explicit Non-Goals For This Release

- No JS harness touch fallback.
- No automatic idb/adb CLI fallback.
- No R3F code in `@0xbigboss/rn-playwright-driver`.
- No broad renderer or game-specific integration in the driver repo.
