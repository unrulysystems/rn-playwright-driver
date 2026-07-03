# @unrulysystems/rn-playwright-driver-runner

## 0.4.0

### Minor Changes

- [#42](https://github.com/unrulysystems/rn-playwright-driver/pull/42) [`9d4afc6`](https://github.com/unrulysystems/rn-playwright-driver/commit/9d4afc663c217de1882989d8cb7fe2d108f2fa74) Thanks [@alleneubank](https://github.com/alleneubank)! - Support physical iOS device runs in the runner with devicectl launch planning,
  device-aware environment values, provisioning opt-in, and project-owned
  pre-launch hooks.

  Add driver and XCTest companion fixes for real-device touch execution, including
  native tap fallback support, configurable XCTest request timeouts, and bundled
  token resources for UI-test companions.

## 0.3.0

### Minor Changes

- [`7161f0f`](https://github.com/unrulysystems/rn-playwright-driver/commit/7161f0f4e3acdb6c5b868f8d2d64807617b8c8fc) Thanks [@alleneubank](https://github.com/alleneubank)! - Add target-aware project-owned setup hooks for runner targets.

  Projects can now return target-scoped Metro env, Playwright env, command steps,
  and cleanup from `hooks.configureTarget`. Hook contributions are rendered in
  `--dry-run`, execute through the runner plan, reject secret-looking env keys,
  and preserve runner-owned driver env precedence.

## 0.2.1

### Patch Changes

- [#32](https://github.com/unrulysystems/rn-playwright-driver/pull/32) [`1558bcc`](https://github.com/unrulysystems/rn-playwright-driver/commit/1558bccbe9afed2ab3021948221e7555fff3899c) Thanks [@alleneubank](https://github.com/alleneubank)! - Fix `rn-driver test --platform ios` failing from-scratch in hoisted monorepos.

  The iOS `scaffold` step spawned the XCTest scaffold via a cwd-relative
  `node_modules/.bin/rn-driver-xctest-scaffold` literal, which `ENOENT`s in a
  Yarn-berry hoisted workspace: the companion's bin is installed to the repo-root
  `node_modules` while the app workspace's `.bin` is empty, and the runner's cwd is
  the app workspace. The runner now resolves the scaffold to an absolute path via
  `createRequire(<cwd>/package.json)` (walking `node_modules` up to the repo root,
  hoist-safe) and spawns it as `node <abs scaffold.js>`. Reading the installed
  companion's own `bin` field keeps resolution deterministic — no `npx` registry or
  version drift.

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
