# @unrulysystems/rn-playwright-driver-instrumentation-companion

## 0.2.1

### Patch Changes

- Refresh the npm package README with companion-backed Android onboarding
  guidance.

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

## 0.1.2

### Patch Changes

- Republish the Android instrumentation companion after npm accepted `0.1.1`
  but did not expose installable package metadata.

## 0.1.1

### Patch Changes

- Publish the Android instrumentation companion package.
  - Add Expo config plugin packaging that copies the companion runner and writes the androidTest manifest/dependencies.
  - Add auth-token handling for the HTTP companion protocol.
  - Document manual Android instrumentation setup for consumers that cannot use the config plugin.
