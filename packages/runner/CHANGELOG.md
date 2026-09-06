# @unrulysystems/rn-playwright-driver-runner

## 0.5.0

### Minor Changes

- [`5e7d593`](https://github.com/unrulysystems/rn-playwright-driver/commit/5e7d593659bd32f0b9a3c771aa238f410947d5f0) Thanks [@alleneubank](https://github.com/alleneubank)! - The runner sets `RN_E2E=1` on every `expo prebuild` it plans and every Metro it starts, the marker the driver's Metro helper and every config plugin in this repository key off. The Android Hermes-target wait now retries with a warm `am start` (no `force-stop`), so a registration in flight survives the retry instead of being discarded on every attempt.

- [`3b264a8`](https://github.com/unrulysystems/rn-playwright-driver/commit/3b264a8339efe3ca2d66393d0e6d83fb507b5aea) Thanks [@alleneubank](https://github.com/alleneubank)! - Validate `launch.kind` against the app package (REQ-CFG-006): when `expo-dev-client` is a dependency of the package next to `rn-driver.config`, a selected platform configured `kind: 'plain'` now fails config validation with the dev-client fix, instead of surfacing sixty seconds later as a `hermes-target` timeout on a fresh simulator or emulator. `validateConfig`/`assertValid` accept an optional `ProjectContext`; `readProjectContext(dir)` builds one from `package.json`.

- [`7d07de9`](https://github.com/unrulysystems/rn-playwright-driver/commit/7d07de9ecf2e4983392942fd57ce5f377ad8685d) Thanks [@alleneubank](https://github.com/alleneubank)! - iOS `NSUserDefaults` seeds (`RCT_jsLocation`, `ios.defaults`) are written into the app's data container after the install; `simctl spawn defaults write <bundleId>` had been writing a simulator-wide domain the sandboxed app never read, and the step now fails the run instead of being best-effort (REQ-IOS-005, REQ-IOS-010). Dev-client apps get the expo-dev-menu seeds on both platforms (`ios.dev-menu`, `android.dev-menu`): onboarding finished, no menu at launch, no floating button. The menu used to open over the app at launch and take the suite's first tap (REQ-IOS-016, REQ-AND-010).

- [`0655e5b`](https://github.com/unrulysystems/rn-playwright-driver/commit/0655e5bba43a4597db7df5522d1d573f233795fc) Thanks [@alleneubank](https://github.com/alleneubank)! - The iOS plan gains an `ios.install-app` step: after the build, the runner asks `xcodebuild -showBuildSettings` for the application product and installs it with `simctl install` (or `devicectl device install app`). XCTest only installs the app under test when the companion launches it, so `attach` mode on a fresh simulator used to fail at `simctl launch` with "not installed" (REQ-IOS-015).

- [`0fe0182`](https://github.com/unrulysystems/rn-playwright-driver/commit/0fe01824451d068d9accf45b49d8a12dfbad50b2) Thanks [@alleneubank](https://github.com/alleneubank)! - Bind the runner-owned Metro to the IPv4 loopback (REQ-METRO-005). Expo advertises `127.0.0.1` in the bundle URL it hands the app, but `expo start --localhost` binds the `localhost` hostname, which Node resolves to `::1` first on hosts that list the IPv6 loopback first; the app then reported "Could not connect to development server" and the `hermes-target` wait timed out. The runner now appends `--dns-result-order=ipv4first` to the Metro process's `NODE_OPTIONS` through a new append-only `CommandSpec.appendEnv`, keeping a consumer's own `NODE_OPTIONS`; `--dry-run` prints it as `NODE_OPTIONS+=…`.

- [`f9f555e`](https://github.com/unrulysystems/rn-playwright-driver/commit/f9f555e5c58153a425d5a9da6fadb1c915eb4067) Thanks [@alleneubank](https://github.com/alleneubank)! - `rn-driver test` now refuses a runtime without the global `WebSocket`/`fetch` its readiness probes need (Node < 22 without bun) at stage `config`, before prebuild and the native build, instead of failing at the companion stage twenty minutes in. `--dry-run` still runs anywhere (REQ-CLI-008).

### Patch Changes

- [`7f583e7`](https://github.com/unrulysystems/rn-playwright-driver/commit/7f583e7bdde8b47d0847028e124d338beb26108f) Thanks [@alleneubank](https://github.com/alleneubank)! - A config the loader cannot parse now fails at stage `config` with the stage's exit code instead of escaping to Node's default handler, which printed an internal stack and exited 1 — Playwright's own code, so an unparseable config was indistinguishable from a failing test run and named no stage, against REQ-CLI-006 and REQ-DIAG-001. Config files that parse were already handled; only the throw path was missing.

- [`3710cf1`](https://github.com/unrulysystems/rn-playwright-driver/commit/3710cf1de005e4013856b6165f0514c286a41a96) Thanks [@alleneubank](https://github.com/alleneubank)! - `--dry-run` now says when it has not resolved `--device`. REQ-CLI-002 keeps that path free of device I/O so it runs offline on a machine with no Xcode or Android SDK, which means a `--device` naming nothing still exits 0 with a plausible plan — and the runner README called that output "the resolved plan" while the example app documented `--dry-run` as the pre-flight to run first, so a typo read as a passing check. The flag table, the pipeline diagram, the root README and the example README now state that device resolution happens only in a real run, and the plan prints an explicit note when `--device` is passed.

- [`701d5a9`](https://github.com/unrulysystems/rn-playwright-driver/commit/701d5a9cac5c7c9b3a6ae606e5007d8081e1140c) Thanks [@alleneubank](https://github.com/alleneubank)! - The root README's canonical runner-config example carried `launch: { mode: 'attach', kind: 'plain' }`, which the runner's own validator rejects (`mode "attach" requires kind "expo-dev-client"`). A consumer copying the one config the CLI requires them to write hit exit 2, while the runner README documented the correct `mode: 'launch'` two files away. The example is corrected, and a new test extracts every complete `defineRnDriverConfig` block from the shipped markdown and runs it through `assertValid`, so a documented example can no longer disagree with the validator.

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
