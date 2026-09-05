# SPEC — rn-playwright-driver: consumer footprint

## Scope

The install surface a consumer app touches when it adopts the driver: its Metro
config, its Expo config plugin list, the environment the runner gives `expo
prebuild` and Metro, and the release artifacts the consumer ships (`expo export`
bundle, prebuilt native project). Package SPECs (`packages/driver/SPEC.md`,
`packages/runner/SPEC.md`) own their APIs; this document owns the promise that
spans them: **no test code in the app binary, and no test branch in app source.**

## Problem

Every documented install (README Options A–C) puts a driver import in the app
entry or requires a second entry Expo cannot select per run. `harness/dev` gates
on a runtime global, so Metro cannot fold the branch and release bundles carry
the harness (#44). The four native modules autolink into production prebuilds and
nothing excludes them (#45). The runner documents `RN_E2E=1` as the prebuild
marker but does not emit it, so consumers gate plugins and the harness in app
config and app entry themselves (#46). Companion adoption needs consumer-written
manifest and `MainApplication` fixes (#47). Harness subpaths export `.ts` sources
that a hoisted Yarn workspace's Metro did not resolve without overrides (#48).
The harness schedules a perpetual `requestAnimationFrame` loop on install (#49).
No check holds the promise (#50). Consumers with a "no test code in the app" rule
cannot adopt the driver as documented (#51).

## Solution

The driver's own packages own the seam. The runner emits the marker. A Metro
helper installs the harness before the app entry only under the marker. A config
plugin excludes the native modules from autolinking by default and lifts the
exclusion under the marker. Every config plugin in this repo no-ops without the
marker. The example app is the reference consumer: its app source has no driver
import and no marker read, and a release-artifact check runs in CI in both
directions.

## Domain model

- **Marker** — `RN_E2E=1` in the process environment of `expo prebuild` and of
  the Metro that serves the e2e bundle. Emitted by the runner; readable by the
  helper and the plugins; never read by app source.
- **Metro seam** — `server.rewriteRequestUrl`, the hook Expo already uses to map its
  dev clients' virtual-entry request to the project entry. The helper composes after
  it and serves a generated entry that loads the harness first.
- **Autolinking exclude** — `use_expo_modules!(exclude: [...])` on iOS and the
  Gradle settings extension's `exclude` on Android, both written into generated
  native files by a config plugin.
- **Release artifact** — an `expo export` bundle with the marker unset, and a
  prebuild with the marker unset.

## Requirements

### Marker and runner — `REQ-SEAM-*`

- **REQ-SEAM-001** The runner sets `RN_E2E=1` in the environment of every
  prebuild step it plans and every Metro it starts. The marker appears in
  `--dry-run` output as env on those steps. A reused Metro the runner did not
  start is the operator's responsibility; the driver's connect reports a named
  diagnostic when the harness global is absent.
- **REQ-SEAM-002** `@unrulysystems/rn-playwright-driver/metro` exports
  `withRnDriverHarness(config)`. With `RN_E2E=1` it writes a static entry to
  `.expo/rn-driver-e2e-entry.js` that loads the harness and then the project entry,
  composes after Expo's `server.rewriteRequestUrl` so a request for the virtual or
  project entry is served that file, resolves the two specifiers the file uses only
  from that file, and adds `rn-driver-e2e` to `cacheVersion`; without the marker it
  adds `rn-driver-off` to `cacheVersion` and touches nothing else. Metro only runs
  `getModulesRunBeforeMainModule` entries already in the graph
  (`metro/src/lib/getAppendScripts.js`), so an entry swap is the seam. `expo export`
  and `export:embed` bundle the project entry directly, so no export carries the
  harness. The helper is unit-tested in both marker states.
- **REQ-SEAM-003** The companion config plugins (`instrumentation-companion`,
  `xctest-companion`) are no-ops unless `RN_E2E=1`, and the native-module plugin
  below acts in both marker states, so a consumer lists all three unconditionally.
  A companion scaffold left by an earlier marked prebuild lives only in test source
  sets (`androidTest`, `*UITests`) that never enter the app product;
  `expo prebuild --clean` removes it.
- **REQ-SEAM-004** `@unrulysystems/rn-playwright-driver` ships `app.plugin.js`
  (`withRnDriverNativeModules`). Without the marker it writes the four driver
  packages (`@unrulysystems/rn-driver-view-tree`, `-screenshot`, `-lifecycle`,
  `-touch`, the npm names Expo autolinking keys an exclusion by) into the generated
  iOS Podfile `use_expo_modules!` exclude list and an `expoAutolinking.exclude`
  assignment before `useExpoModules()` in the Android `settings.gradle`, merging
  with any consumer list. With the marker it removes exactly that list and adds
  nothing, so `expo prebuild` without `--clean` (which reuses existing native
  files) converges in either direction. The exclusion lives only in generated
  native files.

### Harness — `REQ-SEAM-*` (continued)

- **REQ-SEAM-005** `harness/dev` gates on `__DEV__` alone so Metro's release
  transform folds the `require` away. A release export of an entry that imports
  `harness/dev` contains none of `__RN_DRIVER__`, `HARNESS_API_VERSION`, or the
  harness's error strings.
- **REQ-SEAM-006** Installing the harness schedules no per-frame work. The frame
  counter starts on the first `getFrameCount()` or tracing call and is unit-tested
  to be idle after install.
- **REQ-SEAM-007** Under the Metro seam the harness is handed to Metro by absolute
  file path, so a consumer needs no resolver or watch-folder override for the
  harness subpaths. The `./harness` and `./harness/dev` exports remain for the
  legacy entry import and are documented as such.

### Companion side effects — `REQ-SEAM-*` (continued)

- **REQ-SEAM-008** The instrumentation companion plugin owns every native-project
  change the companion needs, and its README states what it does not need: no
  `MainApplication` requirement (no package here reads the app's `ReactHost`), and
  no app-manifest change (its `androidx.test` dependencies declare no storage
  permission; the `WRITE_EXTERNAL_STORAGE` `maxSdkVersion` conflict seen on an
  SDK 54 consumer was between app dependencies and the SDK 55+ template's
  `tools:replace` resolves it). A consumer writes no plugin of its own.

### Release-artifact check — `REQ-SEAM-*` (continued)

- **REQ-SEAM-009** `examples/basic-app` carries `check:footprint`: with the marker
  unset it exports a release bundle and prebuilds both platforms and asserts the
  harness strings and the four modules are absent; with the marker set it repeats
  both and asserts they are present. Either direction failing fails the script.
- **REQ-SEAM-010** The repo CI runs `check:footprint` on every push and pull
  request to `main`. The README states the promise as held by that job, by name.

### Reference consumer — `REQ-SEAM-*` (continued)

- **REQ-SEAM-011** The example app's source contains no driver import and no
  marker read: the harness arrives through `withRnDriverHarness` in
  `metro.config.js`, and its plugin list names the driver plugins
  unconditionally. `rn-driver test --platform ios|android` is green on a
  simulator and an emulator through that install.

## Invariants

- App source never reads the marker and never imports the harness under the
  documented install.
- A prebuild or export without the marker is byte-identical in driver content to
  one from an app that never installed the driver.
- A plugin's effect is a pure function of `(config, RN_E2E)`.

## Non-goals

- Moving view-tree, screenshot, or touch into the companions or host side
  (#45's longer-term shape).
- Physical-device, Expo Go, or bare (non-Expo) React Native installs.
- Verifying a reused Metro's environment from the runner.

## Acceptance

- REQ-SEAM-001: runner plan tests show `RN_E2E=1` on prebuild and Metro steps;
  `--dry-run` prints it.
- REQ-SEAM-002: `metro.test.ts` covers both marker states and the cacheVersion
  component.
- REQ-SEAM-003, -004: plugin unit tests over a fixture Podfile and
  `settings.gradle` in both marker states; `check:footprint` on the example app.
- REQ-SEAM-005, -009, -010: `check:footprint` observed red against a planted
  `__E2E__` gate and against a plugin that stops excluding, then green; the CI
  job exists and runs it.
- REQ-SEAM-006: harness unit test asserts no `requestAnimationFrame` scheduled by
  `installHarness`.
- REQ-SEAM-007: no `resolveRequest` override for the harness in the example app
  or in a hoisted Yarn 4 consumer (Send's `apps/expo`).
- REQ-SEAM-008: the example app's Android prebuild and companion run succeed with
  no consumer plugin; the plugin's tests cover the androidTest manifest merge and
  assert the app manifest is returned untouched.
- REQ-SEAM-011: `rn-driver test --platform ios` and `--platform android` green
  on the example app.

## Traceability

Filled during TDD: `REQ-* → test file:line`.
