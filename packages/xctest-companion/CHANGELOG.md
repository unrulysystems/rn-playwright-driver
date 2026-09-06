# @unrulysystems/rn-playwright-driver-xctest-companion

## 0.3.0

### Minor Changes

- [`5e7d593`](https://github.com/unrulysystems/rn-playwright-driver/commit/5e7d593659bd32f0b9a3c771aa238f410947d5f0) Thanks [@alleneubank](https://github.com/alleneubank)! - The companion config plugins are inert unless `RN_E2E=1` is set for the prebuild (`rn-driver test` sets it), so an app lists them unconditionally and a production prebuild scaffolds nothing. The instrumentation companion README states its native-project requirements: no `MainApplication` change and no app-manifest change.

## 0.2.4

### Patch Changes

- [#42](https://github.com/unrulysystems/rn-playwright-driver/pull/42) [`9d4afc6`](https://github.com/unrulysystems/rn-playwright-driver/commit/9d4afc663c217de1882989d8cb7fe2d108f2fa74) Thanks [@alleneubank](https://github.com/alleneubank)! - Support physical iOS device runs in the runner with devicectl launch planning,
  device-aware environment values, provisioning opt-in, and project-owned
  pre-launch hooks.

  Add driver and XCTest companion fixes for real-device touch execution, including
  native tap fallback support, configurable XCTest request timeouts, and bundled
  token resources for UI-test companions.

## 0.2.3

### Patch Changes

- [#30](https://github.com/unrulysystems/rn-playwright-driver/pull/30) [`4bdbe20`](https://github.com/unrulysystems/rn-playwright-driver/commit/4bdbe2073f7b613f6bfb8d5a13db5e0ca000e1c5) Thanks [@alleneubank](https://github.com/alleneubank)! - Upgrade the dogfood example and native module tooling to Expo SDK 56.

  The driver now sends a React Native inspector-compatible WebSocket Origin when
  attaching to Hermes CDP, which keeps Expo SDK 56 dev-client debugging connected
  on localhost Metro servers. The runner also fast-fails companion readiness when
  captured iOS or Android companion logs contain terminal build, test, or
  instrumentation failure markers instead of waiting for the full probe timeout.

## 0.2.2

### Patch Changes

- [`39f7f7c`](https://github.com/unrulysystems/rn-playwright-driver/commit/39f7f7cb68a6dc77e4e34ecdc6984fa02c58266c) Thanks [@alleneubank](https://github.com/alleneubank)! - Add XCTest companion attach launch mode for host-launched Expo dev-client apps.

## 0.2.1

### Patch Changes

- Refresh the npm package README with companion-backed iOS onboarding guidance.

## 0.2.0

### Minor Changes

- [#19](https://github.com/unrulysystems/rn-playwright-driver/pull/19) [`b74659e`](https://github.com/unrulysystems/rn-playwright-driver/commit/b74659e660437f539cbcf7dbdb5ebcd1b1cb2d0c) Thanks [@alleneubank](https://github.com/alleneubank)! - Cut over touch input confidence paths to platform companions.

  `auto` touch backend selection now fails closed to `xctest` on iOS and
  `instrumentation` on Android. `native-module` and `cli` remain available only
  through explicit `mode: "force"` or explicit backend order configuration.

  The Android instrumentation companion setup now supports token-file auth,
  port configuration, manifest merging, and the example app's companion-backed
  Android e2e script.

  The iOS XCTest companion package now ships scaffold/plugin support, Swift
  companion sources, runtime configuration resources, and the example app's
  companion-backed iOS e2e script.
