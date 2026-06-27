# SPEC — `@unrulysystems/rn-playwright-driver-runner`

A config-backed, cross-platform CLI that owns the native e2e **lifecycle** for
React Native Playwright tests on iOS and Android.

> Status: gate passed. The package shape (separate
> `@unrulysystems/rn-playwright-driver-runner`, bin `rn-driver`) and the
> two-track plan (runner package + example recipe hardening, in parallel) are
> ratified. `BRIEF.md` (colocated) is the quality bar. Implementation builds the
> headless-verifiable interior (config, pure planners, executor, CLI) to a
> terminal `bun run check`; the live e2e on a real simulator/emulator is the
> human-attended oracle (Boundary).

## Problem

Driving an RN app from Playwright requires a live, correctly-wired world before
the first `device` call: Metro serving the right bundle, the platform touch
companion running and reachable, the app cold-launched against that Metro with a
Hermes target registered, and the right device disambiguated on a shared Metro.
Today that orchestration lives in ~400-line per-app bash recipes
(`examples/basic-app/scripts/e2e-ios-xctest.sh`,
`examples/basic-app/scripts/e2e-android-instrumentation.sh`). App developers are
expected to copy and maintain those recipes. They are fragile, platform-specific,
and encode hard-won edge cases (dev-client launch semantics, companion build
time, stale-port cleanup) that every adopter rediscovers by failing.

The BOSS adoption proved this: a downstream team re-derived three fixes
(`simctl launch --initialUrl` + terminate-first; a 300s configurable companion
readiness bound; `lsof`-based stale-port cleanup) that belong in the tool, not in
each app's shell. See `boss/apps/mobile/scripts/rn-e2e-ios-xctest.sh`.

## Solution

A separate package `@unrulysystems/rn-playwright-driver-runner` providing:

1. `defineRnDriverConfig(config)` — a typed config helper, loaded from a
   project `rn-driver.config.ts`.
2. A `rn-driver` CLI whose primary command is `rn-driver test --platform <ios|android|all>`.

The runner owns the **generic** native lifecycle (simulator/emulator selection,
Metro ownership, companion startup, secure token/config passing, cold-launch
semantics, Hermes target wait, cleanup) and translates a developer's
**app-specific facts** (bundle id / package name, schemes, workspace/Gradle
tasks, launch kind) into a deterministic, ordered execution plan. It then sets
the driver's documented environment-variable contract and invokes Playwright.

The core driver stays orchestration-free and renderer-agnostic (CLAUDE.md
"optional integrations are separate packages"). The runner depends on the driver
and orchestrates the companion packages; neither the driver nor the companions
depend on the runner.

## Domain model

### Layering (the testability seam)

```
config (rn-driver.config.ts)
  └─ loadConfig() ───────────────► RunnerConfig          (validated, typed)
       └─ resolveEnvironment() ──► ResolvedTarget         (device/sim, ports, metro url, token refs)
            └─ planIos()/planAndroid() ──► Plan = Step[]  (PURE: no side effects)
                 └─ execute(plan, ProcessRunner) ───────► result  (EFFECTFUL: the boundary)
                      └─ runPlaywright(env) ────────────► pass/fail
```

- **Planning is pure.** `planIos(config, resolved)` and `planAndroid(config, resolved)`
  return a `Plan` (ordered `Step`s) with no I/O. This is what unit tests assert.
- **Execution is the side-effect boundary.** A `ProcessRunner` interface
  (`spawn`, `exec`, `probe`, `writeFile`, `freePort`) is the only thing that
  touches the OS. Tests inject a mock `ProcessRunner` to assert order, env,
  readiness gating, cleanup-on-failure, and secret-safety without real devices.

### Core types (illustrative; exact shapes ratified during TDD)

```ts
type Platform = 'ios' | 'android'
type LaunchMode = 'launch' | 'activate' | 'attach'
type LaunchKind = 'plain' | 'expo-dev-client'

interface Step {
  id: string // stable, e.g. 'ios.prebuild', 'metro.start'
  description: string
  run: CommandSpec | InternalAction
  readiness?: ReadinessProbe // poll-until with bounded timeout
  background?: boolean // long-lived (Metro, companion)
  cleanup?: CleanupSpec // teardown registered when step starts
}

interface CommandSpec {
  command: string
  args: string[] // NEVER contains a secret value
  env?: Record<string, string> // NEVER contains a secret value
  cwd?: string
}

interface SecretRef {
  tokenFile: string
} // secrets travel by file path, never by value
```

### The environment-variable contract (runner output → driver input)

The runner's job ends by setting the variables the Playwright fixture already
reads (`packages/driver/src/test-env.ts`, README "Configuration"). The runner
does not invent a new driver API; it produces this contract:

| Variable                                                               | Set by runner for                            |
| ---------------------------------------------------------------------- | -------------------------------------------- |
| `RN_METRO_URL`                                                         | both                                         |
| `RN_DEVICE_ID` / `RN_DEVICE_NAME`                                      | both (Hermes target disambiguation)          |
| `RN_TIMEOUT`                                                           | both (from config)                           |
| `RN_TOUCH_BACKEND`                                                     | `xctest` (ios) / `instrumentation` (android) |
| `RN_TOUCH_XCTEST_PORT`, `RN_TOUCH_XCTEST_TOKEN_FILE`                   | ios                                          |
| `RN_TOUCH_INSTRUMENTATION_PORT`, `RN_TOUCH_INSTRUMENTATION_TOKEN_FILE` | android                                      |
| `ANDROID_SERIAL`                                                       | android                                      |

## Requirements

### Config loading & validation — `REQ-CFG-*`

- **REQ-CFG-001** The runner loads configuration from `rn-driver.config.ts`
  (default), resolved upward from the cwd, overridable with `--config <path>`.
  TypeScript config is supported via a TS-aware loader.
- **REQ-CFG-002** `defineRnDriverConfig(config)` is an identity helper that
  provides editor/type checking; it performs no I/O.
- **REQ-CFG-003** Config is validated before any side effect. Validation failures
  exit non-zero with an actionable message naming the offending field and the
  expected shape. Missing required platform fields for a selected platform fail
  fast (e.g. selecting `--platform ios` without `ios.bundleId`/`ios.workspace`).
- **REQ-CFG-004** Unknown/extra config keys are reported (typo protection), not
  silently ignored.
- **REQ-CFG-005** A platform absent from config is a hard error only when that
  platform is selected; `--platform all` with only `ios` configured fails fast
  naming `android` as unconfigured.

### CLI surface & platform selection — `REQ-CLI-*`

- **REQ-CLI-001** `rn-driver test --platform <ios|android|all>` is the primary
  command. `all` runs platforms sequentially (v1; parallel is a non-goal).
- **REQ-CLI-002** `--dry-run` prints the fully-resolved ordered plan (every Step
  with its command/args/env, secrets shown as `<token-file>` references) and
  exits 0 **without any side effect** (no prebuild, no spawn, no device touch).
- **REQ-CLI-003** `--verbose` streams per-step progress and, on failure, the
  tail of the relevant background log (Metro / companion).
- **REQ-CLI-004** `--skip-build` reuses an already-built native project
  (DerivedData / installed APKs) and re-runs only the companion/launch/Playwright
  steps, refreshing the per-run token/config first.
- **REQ-CLI-005** Spec selection and Playwright passthrough: positional spec args
  and everything after `--` are forwarded to Playwright verbatim.
- **REQ-CLI-006** Exit code is the Playwright exit code on a completed run, or a
  distinct non-zero code for each pre-Playwright lifecycle failure class
  (see REQ-DIAG-001).
- **REQ-CLI-007** Device override flags (`--device <id|name>`) take precedence
  over config device-selection preferences.

### Metro ownership — `REQ-METRO-*`

- **REQ-METRO-001** If `metro.reuseExisting` and a packager already answers
  `packager-status:running` at the resolved URL, the runner reuses it and does
  not start or kill Metro.
- **REQ-METRO-002** Otherwise the runner starts Metro via `metro.command`,
  redirects its output to a captured log, and waits for
  `${url}/status → packager-status:running` within a bounded timeout.
- **REQ-METRO-003** Port resolution: honor `metro.url` if set; else use
  `metro.port` (default 8081). When the runner owns Metro (not `reuseExisting`),
  it verifies the port is free before starting Metro and fails fast at the
  `metro` stage if occupied. It does not auto-probe a different port, because
  `metro.command` pins the port the packager binds — moving the port silently
  would desync the command from the readiness probe.
- **REQ-METRO-004** Metro started by the runner is owned by the runner and is
  terminated in cleanup; reused Metro is never terminated.

### iOS XCTest lifecycle — `REQ-IOS-*`

- **REQ-IOS-001** Resolve the simulator: honor an explicit destination/udid;
  else prefer a booted iPhone; else select the newest available iPhone runtime
  and boot it (`simctl boot` + `bootstatus -b`).
- **REQ-IOS-002** Before launch, terminate stale instances of the app bundle on
  **other** booted simulators so their Metro targets do not pollute device
  selection.
- **REQ-IOS-003** Generate the native project and companion target:
  `expo prebuild --platform ios`, run the xctest companion scaffold, copy the
  per-run runtime-config JSON into the UI-test target resource, inject the
  `RN_TOUCH_XCTEST_CONFIG_FILE` scheme environment variable, `pod install`, and
  assert the UI-test scheme exists. Steps that mutate the project are skipped
  under `--skip-build` except the token/config refresh.
- **REQ-IOS-004** `xcodebuild` is invoked with `LD` unset (`env -u LD`) to avoid
  the generic-Unix `LD=ld` link failure.
- **REQ-IOS-005** Point the app at this Metro via the app's `NSUserDefaults`
  (`RCT_jsLocation`, `RCT_packager_scheme`) and build the app scheme with
  `RCT_METRO_PORT`.
- **REQ-IOS-006** Free the companion port (`lsof -iTCP:<port> -sTCP:LISTEN -t |
kill`) **before** starting the companion, then start the companion UI test
  (`xcodebuild test -only-testing:<UITests>/RNDriverTouchCompanionTests/testRunServer`)
  in the background. _(FU-3)_
- **REQ-IOS-007** Wait for the companion to accept a WebSocket `hello` within a
  configurable timeout defaulting to **300s** (`ios.companion.readyTimeoutMs`),
  failing fast if the `xcodebuild test` process dies first. The default must
  cover a cold `xcodebuild test` build, not just process startup. _(FU-2)_
- **REQ-IOS-008** Launch semantics by `ios.launch.kind`:
  - `plain`: companion `launch`/`activate` mode launches the app.
  - `expo-dev-client`: companion runs in `attach` mode (does not launch), the
    runner **terminates any running instance first** then cold-launches via
    `simctl launch <udid> <bundleId> --initialUrl <metro-http-url>`. It does
    **not** use `simctl openurl` (which trips an untappable SpringBoard
    confirmation on fresh installs). _(FU-1)_
- **REQ-IOS-009** Wait for a Hermes/React Native target whose `deviceName`
  matches the selected simulator (substring), within a bounded timeout, before
  invoking Playwright; emit diagnostics (Metro `/json`, companion log tail) on
  timeout.
- **REQ-IOS-010** App-specific pre-launch seeds (e.g. dev-menu onboarding
  defaults) are expressed as config (`ios.defaults` → `simctl spawn defaults
write`), not hard-coded.

### Android instrumentation lifecycle — `REQ-AND-*`

- **REQ-AND-001** Resolve the emulator/device serial: honor `RN_DEVICE_ID` /
  `--device`; else the first booted `emulator-*`; verify `get-state == device`
  and `sys.boot_completed == 1`.
- **REQ-AND-002** Generate the native project (`expo prebuild --platform
android`), configure JDK 17 if `JAVA_HOME` is unset, and build the app +
  androidTest APKs via the configured Gradle tasks
  (default `:app:assembleDebug :app:assembleDebugAndroidTest`).
- **REQ-AND-003** Install both APKs (`adb install -r`, test APK with `-t`).
- **REQ-AND-004** Configure debug host: `adb reverse tcp:<metroPort>`, write the
  app's `debug_http_host` shared-pref, and (if Metro is not on 8081) reverse 8081
  as well.
- **REQ-AND-005** Launch the app (`am start -W -n <package>/<activity>`) with
  bounded retries, waiting for the app's Hermes target after each attempt.
- **REQ-AND-006** Start the instrumentation companion: `adb forward tcp:<port>`,
  then `am instrument -w` targeting the companion, passing the auth token by the
  **device-private token-file argument** (`rnDriverAuthTokenFile`), never the
  inline token argument.
- **REQ-AND-007** Wait for the companion to answer an authenticated `hello`
  (`POST /command`) within a bounded timeout, failing fast if the instrument
  process dies first.
- **REQ-AND-008** Select the Android Hermes target by `appId` + RN/Hermes
  signature + android device match, and pass its `deviceName` to the driver via
  `RN_DEVICE_NAME`.

### Secure token handling — `REQ-SEC-*`

- **REQ-SEC-001** Each run mints a fresh random token written to a `0600` file;
  the token **value** never appears in process argv, in inline env assignments,
  in stdout/stderr, or in `--dry-run` output (shown as `<token-file>`).
- **REQ-SEC-002** iOS passes the token to the companion via the runtime-config
  JSON (`authTokenFile`) and the injected scheme env, both pointing at the
  `0600` file. Android installs the token into the app's private `files/`
  directory via `run-as` and references it by `rnDriverAuthTokenFile`.
- **REQ-SEC-003** The token reaches Playwright only as a file path
  (`RN_TOUCH_*_TOKEN_FILE`), matching the existing fixture contract; the inline
  `RN_TOUCH_*_TOKEN` form is not emitted by the runner.
- **REQ-SEC-004** Per-run token and config files are removed in cleanup,
  including on failure paths.

### Cleanup — `REQ-CLEAN-*`

- **REQ-CLEAN-001** Cleanup runs on every exit path (success, failure, signal)
  and is **idempotent**: re-running the runner after a crashed prior run
  succeeds without manual intervention.
- **REQ-CLEAN-002** Cleanup frees the companion port (`lsof`+kill) because
  killing the `xcodebuild`/`am instrument` parent does not always reap the
  device/sim-hosted companion child that holds the port. The same free runs at
  startup (REQ-IOS-006) so a crashed prior run never wedges the next. _(FU-3)_
- **REQ-CLEAN-003** Android cleanup removes `adb reverse`/`forward` mappings,
  the device-private token file, and force-stops the app.
- **REQ-CLEAN-004** Cleanup terminates the resources the runner manages — its
  spawned Metro and companion, `adb` mappings, the per-run token file — and frees
  the **dedicated** companion port (`*.companion.port`, default 9999), which must
  not be shared with an unrelated service; it never kills a reused Metro.

### Diagnostics — `REQ-DIAG-*`

- **REQ-DIAG-001** Every pre-Playwright failure is attributed to a named stage —
  `config`, `metro`, `device`, `build`, `companion`, `app-launch`,
  `hermes-target` — in the error message and the exit code, so a failure says
  _which_ stage failed, not just "it failed".
- **REQ-DIAG-002** On a stage timeout, the runner emits the relevant evidence
  (Metro `/json`, Metro log tail, companion log tail, `adb logcat`/app pid for
  Android) before exiting.
- **REQ-DIAG-003** `--dry-run` (REQ-CLI-002) is the primary inspection tool:
  the full plan is printed and auditable without running anything.

### Playwright invocation — `REQ-PW-*`

- **REQ-PW-001** Playwright is invoked with the resolved env contract and the
  configured Playwright config (`playwright.config` default), plus forwarded
  spec/`--` args.
- **REQ-PW-002** The runner does not own assertions or fixtures; it only
  establishes the world and delegates pass/fail to Playwright + the driver
  fixture (independence: the runner is not its own oracle).

### Packaging & architecture — `REQ-PKG-*`

- **REQ-PKG-001** The runner ships as a separate package
  `@unrulysystems/rn-playwright-driver-runner` under `packages/runner`, built
  with tsup (dual ESM/CJS + types) consistent with the driver.
- **REQ-PKG-002** The core driver package gains **no** dependency on the runner
  or the companions. The runner depends on the driver (for the env contract /
  shared types); it invokes companion scaffolds via their bins from the app's
  `node_modules` rather than hard-importing them.
- **REQ-PKG-003** The runner exposes a `rn-driver` bin and the
  `defineRnDriverConfig` export.

## Invariants

- The token value is never observable in argv, inline env, logs, or `--dry-run`.
- A completed run (pass or fail) leaves no stale companion bound to the touch
  port and no orphaned runner-owned Metro.
- The runner forces the companion backend (`RN_TOUCH_BACKEND`) and never
  silently falls back to a weaker backend; a missing companion is a stage
  failure with diagnostics.
- Planning (`planIos`/`planAndroid`) is pure: identical config + resolved target
  ⇒ identical plan, with zero I/O.
- The runner produces the existing driver env contract; it does not introduce a
  parallel driver configuration surface.
- Cleanup never terminates a Metro the runner did not start.

## Non-goals (v1)

- Magic app discovery (auto-detecting bundle id / schemes / Gradle tasks).
  v1 is explicit config with actionable validation errors.
- Parallel multi-device / multi-platform execution. `--platform all` is
  sequential.
- Owning Playwright assertions, fixtures, or the `device` API surface.
- Provisioning devices, installing Xcode/Android SDK, or first-launch Xcode
  acceptance (human-attended prerequisites).
- Real-device (non-emulator/simulator) topologies beyond what the existing
  recipes support.
- Replacing the companion packages; the runner orchestrates them.

## Risk tags

- **Public API / package surface (high):** new published package + `defineRnDriverConfig`
  contract + `rn-driver` CLI. Requires SPEC + plan approval before implementation
  (this gate).
- **Outward-facing (boundary):** publishing, version bumps, PRs, issue filing,
  closing #21 — all human.
- **Low-risk, separable:** hardening the existing example scripts (FU-1/2/3) is a
  patch that does not change public API and can land independently.

## Acceptance criteria

Implementation-time gates (not satisfied by this SPEC; tracked for the build):

- [ ] `defineRnDriverConfig` + `loadConfig` load and validate `rn-driver.config.ts`;
      malformed config fails with a field-named, actionable error (`REQ-CFG-*`).
- [ ] `planIos`/`planAndroid` are pure and unit-tested to emit the expected
      ordered Steps for representative configs, including `--skip-build` and both
      launch kinds (`REQ-IOS-*`, `REQ-AND-*`).
- [ ] Plan execution against a mocked `ProcessRunner` asserts step order,
      readiness gating, cleanup-on-failure, and that no token value appears in any
      `CommandSpec.args`/`env` (REQ-SEC-001, `REQ-CLEAN-*`).
- [ ] `rn-driver test --platform ios --dry-run` and `--platform android --dry-run`
      print the full plan and exit 0 with no side effects (REQ-CLI-002).
- [ ] FU-1/2/3 behaviors are encoded and unit-asserted: dev-client uses
      `simctl launch --initialUrl` with terminate-first; the 300s companion
      readiness default is configurable; the companion port is freed at startup
      and in cleanup (REQ-IOS-007/008, REQ-CLEAN-002).
- [ ] Example app migrated to `rn-driver.config.ts`; `bun run test:e2e:ios` and
      `bun run test:e2e:android` pass through the runner on a real
      simulator/emulator (the independent oracle).
- [ ] Re-run idempotency: two consecutive runner invocations both pass without
      manual port/process cleanup between them (REQ-CLEAN-001).
- [ ] `bun run check` (typecheck + lint + format + unit tests) is green for the
      new package.
- [ ] README/docs config examples typecheck against the exported config schema.

## Open items

- Config loader choice (jiti / bundle-require / native `--import`) is unresolved;
  decide during PLAN with a bias toward zero-extra-runtime-dependency.
- Exact `RunnerConfig` field names and defaults are illustrative here and are
  ratified during TDD; this SPEC fixes behavior, not final identifiers.
- Whether the iOS scheme-env injection and runtime-config copy can be replaced by
  a single companion-side config mechanism is a future simplification, out of
  scope for v1.

## Traceability

Added during/after TDD: `REQ-* → test file:line`. Empty at SPEC authoring time.
