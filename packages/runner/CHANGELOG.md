# @unrulysystems/rn-playwright-driver-runner

## 0.2.0

### Minor Changes

- [#30](https://github.com/unrulysystems/rn-playwright-driver/pull/30) [`4bdbe20`](https://github.com/unrulysystems/rn-playwright-driver/commit/4bdbe2073f7b613f6bfb8d5a13db5e0ca000e1c5) Thanks [@alleneubank](https://github.com/alleneubank)! - Upgrade the dogfood example and native module tooling to Expo SDK 56.

  The driver now sends a React Native inspector-compatible WebSocket Origin when
  attaching to Hermes CDP, which keeps Expo SDK 56 dev-client debugging connected
  on localhost Metro servers. The runner also fast-fails companion readiness when
  captured iOS or Android companion logs contain terminal build, test, or
  instrumentation failure markers instead of waiting for the full probe timeout.

## 0.1.1

### Patch Changes

- [#27](https://github.com/unrulysystems/rn-playwright-driver/pull/27) [`b8eb24e`](https://github.com/unrulysystems/rn-playwright-driver/commit/b8eb24e9daef7f00605fe06dcf520089f62f58be) Thanks [@alleneubank](https://github.com/alleneubank)! - Harden the runner and driver fixtures for dev-client dogfooding.

  The runner now ships a Node-compatible `rn-driver` bin, supports Android
  Expo dev-client deep-link launch, and documents runner-owned lifecycle
  boundaries. The driver Playwright fixture resolves `@playwright/test` from the
  consumer project so npm and Yarn installs use the app's Playwright instance.

## 0.1.0

### Initial Release

- Add the config-backed `rn-driver` native e2e lifecycle runner for iOS and Android.
- Add typed `rn-driver.config.ts` support through `defineRnDriverConfig`.
- Add pure iOS/Android lifecycle planning, runner execution, dry-run output, and release-shape tests.
