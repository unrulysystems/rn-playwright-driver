# agent-device as a device backend

Research spike, 2026-10-11. This document records a recommendation. It does not
change the driver contract in `SPEC.md` or the touch-backend implementation.

## Recommendation

**Don't** adopt Callstack's [agent-device](https://github.com/callstack/agent-device)
as the device backend for `rn-playwright-driver`.

The backlog item it was weighed against is iOS `idb` support on
`CliTouchBackend`, plus device-backed smoke tests. `idb` is the tool that
matches that item: an iOS HID CLI (`idb ui tap`, `idb ui swipe`, `idb ui text`)
with the same coordinate shape the CLI backend already uses for `adb`.
agent-device is a separate automation product (accessibility sessions, a
daemon, its own XCTest runner, Metro helpers, cloud devices). Putting it under
the driver's touch seam would import that product to cover four CLI calls, and
it still cannot express the streaming pointer methods the seam requires.

Reopen the question only if all of the following become true:

1. The driver drops streaming `down` / `move` / `up` from `TouchBackend`, or
   agent-device's published client grows those methods. The compile check in
   `spikes/agent-device-touch` fails when they appear.
2. The driver's published Node floor moves to `>=22.12`, and the CJS build
   (`packages/driver/tsup.config.ts` emits `esm` and `cjs`) can load
   agent-device. The published package is ESM-only (`"type": "module"`,
   `exports` `import` only, no `require` condition) and declares
   `"node": ">=22.12"`.
3. The runner, not a second daemon, owns device and port lifetime. agent-device
   sessions claim devices per worktree; the runner already owns companion
   ports and `adb` forwards (`packages/runner/SPEC.md`, decision 2026-09-08).
4. A macOS rehearsal shows a simulator coordinate tap and a physical-device
   runner start. This spike ran on Linux and did not.

Until then, the iOS CLI gap stays an `idb` task, and smoke tests stay on the
existing companion and `adb` paths.

## What each one is

|               | This driver                                                                            | agent-device 0.21.25                                                             | idb                                                       |
| ------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Job           | Playwright-style tests of a React Native app over Hermes CDP, plus an OS touch channel | Agent inspect / act / verify loop: CLI, MCP, typed Node client                   | iOS simulator and device automation CLI                   |
| Query model   | `__RN_DRIVER__` harness over CDP (test id, text, role, bounds)                         | Accessibility snapshots, refs, selectors                                         | Accessibility reads on simulators; HID on coordinates     |
| Input model   | `TouchBackend`: `tap`, `down`, `move`, `up`, `swipe`, `longPress`, `typeText`          | Completed gestures: `press`, `longPress`, `swipe`, `type`, plus pans and pinches | `idb ui tap X Y`, `swipe`, `text`, and other HID commands |
| Process model | The test process talks to CDP and to a companion or `adb`                              | A daemon; the client calls `sendToDaemon` unless a transport is injected         | `idb_companion` on macOS, Python/CLI client               |

Sources: `docs/NATIVE-MODULES-ARCHITECTURE.md` (two-channel diagram and the
touch-tier table), `packages/driver/src/touch/backend.ts`,
`packages/driver/src/pointer.ts`, agent-device `README.md` and
`src/agent-device-client.ts` at
[`da46f4c1`](https://github.com/callstack/agent-device/commit/da46f4c1c248c22047dc607cb0979e8220e1a223),
[idb UI automation](https://raw.githubusercontent.com/facebook/idb/main/website/docs/idb/ui.mdx).

## Platform coverage

The driver targets iOS and Android only. Queries go through Hermes CDP on both.
Touch defaults are the in-repo companions: `xctest` on iOS and `instrumentation`
on Android (`packages/driver/src/touch/index.ts`). `cli` is implemented for
Android `adb` and is rejected on iOS (`isBackendSupportedOnPlatform`). File
transfer is `simctl` (iOS simulator), `devicectl` (iOS device), and `adb`
(Android) (`packages/driver/src/files/transports/index.ts`).

agent-device's README (same commit) lists iOS, Android, HarmonyOS, tvOS,
Android TV, Amazon Vega OS, web, macOS, and Linux, on simulators, emulators,
and physical devices, plus remote clouds (BrowserStack, AWS Device Farm,
TestMu AI, Limrun). Its own docs say support depth varies and
`agent-device capabilities --platform <platform>` is the per-target list.
HarmonyOS and Vega are subsets (`website/docs/docs/known-limitations.md` and
the commands page). None of those extra platforms are a driver requirement.

`idb` is iOS simulators and devices only. The README describes a macOS
companion plus a client that can run elsewhere, aimed at a device lab. It does
not speak Android, so it cannot replace `CliTouchBackend`'s `adb` path or the
instrumentation companion.

## Physical devices

The runner already launches physical iOS through `devicectl` and Android
through `adb` (`packages/runner/src/plan/ios.ts`,
`packages/runner/src/runner/resolve.ts`). The iOS touch companion is an XCTest
target scaffolded into the app (`packages/xctest-companion`). The Android
confidence path is the instrumentation companion; `adb shell input` is the
explicit lower-fidelity CLI (`docs/CI.md`, `packages/driver/src/touch/cli-backend.ts`).

agent-device physical iOS uses CoreDevice (`devicectl`) and a separate
`AgentDeviceRunner` XCTest bundle that the daemon builds with `xcodebuild`
(`packages/platform-apple/src/runner/runner-artifact.ts`, scheme
`AgentDeviceRunner`). Installation docs require the device paired, trusted,
Developer Mode on, and the runner signed before commands run
([Installation](https://github.com/callstack/agent-device/blob/da46f4c1c248c22047dc607cb0979e8220e1a223/website/docs/docs/installation.md)).
Physical Android uses ADB. Real-device non-ASCII text needs `--test-ime`
because the helper IME is off by default on hardware
(`website/docs/docs/known-limitations.md`). Clipboard commands return
`UNSUPPORTED_OPERATION` on physical iOS (commands doc, clipboard section).

`idb` HID commands "work on Simulators, and a subset works on Devices."
Accessibility operations, including marker taps, are "currently supported on
iOS Simulators only" (idb `ui.mdx`, intro). The page does not list which HID
commands are in the device subset. Coordinate `idb ui tap X Y` is specified as
synthesized HID, which is the operation the backlog describes.

## Maintenance

Figures below were read on 2026-10-11 from the GitHub REST API and the npm
registry. Commit-search `total_count` is whatever that API returns for the
query; it is not a hand-counted unique-author total. Contributor totals are
the paginated `contributors` API (commit counts on the default branch).

|                                                | agent-device                                                             | idb                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Repo                                           | `callstack/agent-device`                                                 | `facebook/idb`                                                 |
| Created                                        | 2026-01-30                                                               | 2015-09-03                                                     |
| Archived                                       | no                                                                       | no                                                             |
| License                                        | MIT (`LICENSE`, npm, GitHub)                                             | MIT (GitHub `license.spdx_id`, README)                         |
| Pushed                                         | 2026-10-11                                                               | 2026-10-11                                                     |
| Latest release                                 | `v0.21.25` on 2026-10-11                                                 | `v1.6.9` on 2026-10-09                                         |
| Version line                                   | 0.x. npm `0.1.0` on 2026-01-31; 184 published versions through `0.21.25` | 1.x                                                            |
| Stars / open issues                            | 4971 / 106                                                               | 5362 / 187                                                     |
| Commits with `committer-date` after 2026-07-13 | search `total_count` 1391                                                | search `total_count` 3272                                      |
| Contributors API                               | 68 accounts, 2454 counted contributions. `thymikee` 2235                 | 138 accounts, 8752 counted contributions. `lawrencelomax` 7425 |

Both histograms are concentrated. agent-device is also an organization repo
(Callstack copyright, 2026, `package.json` `"author": "Callstack"`), so the
bus-factor question is knowledge concentration inside an active org project,
not an unowned personal archive. The offsetting risk is age and stability: the repository was created on
2026-01-30, the package is still 0.x, and the releases API shows `v0.21.19`
through `v0.21.25` between 2026-10-06 and 2026-10-11. `idb` is a 1.x CLI with a brew formula and a documented `ui`
command group; its docs moved under the current `idb ui` shape, which is a
reason to re-read `ui.mdx` before implementing the backlog commands rather
than a reason to prefer agent-device.

`idb`'s companion install path in the README is `brew install facebook/fb/idb`
on macOS. The Python client requires Python 3.10 or newer (README). That is
a host tool, not an npm dependency of this repo.

## Dependency and signing burden

### Node

| Surface                                      | Floor      | Source                                                   |
| -------------------------------------------- | ---------- | -------------------------------------------------------- |
| Repo pin                                     | 24.17.0    | `.node-version`                                          |
| `@unrulysystems/rn-playwright-driver`        | `>=18.0.0` | `packages/driver/package.json` `engines`                 |
| `@unrulysystems/rn-playwright-driver-runner` | `>=22.0.0` | `packages/runner/package.json` `engines`                 |
| `agent-device@0.21.25`                       | `>=22.12`  | npm registry `engines`, and the installed `package.json` |

24.17.0 satisfies `>=22.12`. A consumer on the driver's published floor (Node 18) or on the runner's floor (Node 22.0 through 22.11) does not. Web
automation in agent-device wants Node 24 (`website/docs/docs/installation.md`);
this driver does not need that path.

The published tarball has no runtime `dependencies` (npm metadata
`dependencies` empty; unpacked size 5,170,803 bytes). The optional peer is
`ai`. The cost is the package itself (daemon, Apple runner sources, Android
helper apks in `files`) and the Node floor, not a deep npm tree.

Importing it from `packages/driver/src` would put an ESM-only module on the
CJS `require` build. The spike stays outside the workspaces (`packages/*`,
`examples/*` in the root `package.json`) so `nub ci` does not install it into
the published graph.

### Signing the iOS runner

agent-device builds `AgentDeviceRunner` with `xcodebuild build-for-testing` on
first iOS use. Signing settings depend on device kind
(`resolveRunnerSigningBuildSettings` in
`packages/platform-apple/src/runner/runner-cache-metadata.ts`, called from
`runner-artifact.ts` with `device.kind === 'device'`):

- Simulator builds pass no signing overrides. The unit test
  `resolveRunnerSigningBuildSettings ignores device signing overrides for simulator builds`
  expects `[]` even when `AGENT_DEVICE_IOS_TEAM_ID` is set. Device builds add
  `-allowProvisioningUpdates`; simulator builds do not.
- Physical devices get `CODE_SIGN_STYLE=Automatic` (or `Manual` when a
  provisioning profile name is set), plus `DEVELOPMENT_TEAM` from
  `AGENT_DEVICE_IOS_TEAM_ID` when that variable is set. Failure reasons include
  `signing_no_development_team` and `signing_provisioning_profile_missing`
  (installation doc and `runner-error-classification.ts`).

This repo's companion is a UI-test target in the app project. The scaffold
sets `CODE_SIGN_STYLE: 'Automatic'` and
`PRODUCT_BUNDLE_IDENTIFIER` to `"${appBundleId}.${targetName}"`
(`packages/xctest-companion/plugin/scaffold.js`). It uses the app target's
team and profile, which the app already needs for a device build. It does
not introduce a second bundle id owned by agent-device
(`AGENT_DEVICE_IOS_BUNDLE_ID`, defaulting inside their runner).

### CI

`.github/workflows/ci.yml` runs lint, typecheck, unit tests, build, and the
release-footprint check on `ubuntu-latest`. The workflow comment states that
E2E needs a device or simulator and is local or self-hosted. `docs/CI.md`
names the companion-backed paths as the release confidence path.

agent-device's iOS runner needs Xcode (`xcodebuild`, `simctl`, `devicectl`).
That cannot run on the current Ubuntu jobs. Adopting the client would not
add iOS coverage to those jobs. A macOS job would gain a first-run
`xcodebuild` of `AgentDeviceRunner` and, for physical devices, a signing
identity in CI secrets. Simulator runs omit the team override, but they still
need a Mac with Xcode. Android would still need an emulator or a device, which
the repo already requires for `adb` and instrumentation smoke tests.

`nix develop` was verified on Linux (`x86_64`, Nix 2.35.2, single-user install
because PID 1 is not systemd). `nix develop --command` resolved `nub` 0.2.3
from the flake store. The shell did not put Node 24 on `PATH` by itself
(`node` resolved to `/exec-daemon/node` v22.14.0, and `nub exec node` reported
that `node` is not installed in `node_modules/.bin`). `nub node install` then
provisioned Node 24.17.0 from `.node-version`. Darwin was not run.

## Fit with the architecture

The plug-in point for input is `TouchBackend`
(`packages/driver/src/touch/backend.ts`) and `createTouchBackend`
(`packages/driver/src/touch/index.ts`). A new backend would be another arm of
`TouchBackendName`, next to `xctest`, `instrumentation`, `native-module`, and
`cli`. The runner would have to start and stop the agent-device daemon the
way it starts the companion, and tests would still connect to Hermes for
`device.evaluate`, locators, and screenshots that go through the harness.

What a coordinate client can stand in for, from the published types
(`PressOptions`, `LongPressOptions`, `SwipeOptions`, `TypeTextOptions` at
agent-device `0.21.25`):

| `TouchBackend`         | agent-device client                            | Notes                                                                                                                                                      |
| ---------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tap(x, y)`            | `interactions.press({ x, y })`                 | One completed press. `Pointer.tap` uses this only when `holdStart` is omitted; otherwise it sends `down` / `up` itself (`packages/driver/src/pointer.ts`). |
| `longPress`            | `interactions.longPress({ x, y, durationMs })` | Same split: holds route through `down` / `up`.                                                                                                             |
| `swipe`                | `interactions.swipe({ from, to })`             | agent-device `swipe` has no duration. Timed drags are `pan({ x, y, dx, dy, durationMs })`.                                                                 |
| `typeText`             | `interactions.type({ text })`                  | Types into the focused field.                                                                                                                              |
| `down` / `move` / `up` | no method                                      | `Pointer` interpolates drags, pinches, and rotates by calling these.                                                                                       |

`InteractionTarget` is a `PointTarget | RefTarget | SelectorTarget`
(`packages/contracts/src/client-target.ts` in the clone). Point targets are
`{ x, y }` with the other fields forbidden. That matches a coordinate tap. It
does not match a pointer stream, a `pointerId`, or the driver's
`pointer.down` / `move` / `up` API.

Coordinate spaces differ by platform, and the spike does not convert:

- The driver pointer API is logical points (`packages/driver/src/pointer.ts`).
  `CliTouchBackend` multiplies by the React Native pixel ratio before `adb`
  (`packages/driver/src/touch/cli-backend.ts`).
- agent-device: "Android bounds are physical pixels ... and so are the points
  `press`, `fill`, and the gesture commands take." "iOS already reports
  points" (`website/docs/docs/snapshots.md`, Android node metadata).
- `idb ui` points use "the screen's points coordinate system, with the origin
  at the top left" (`ui.mdx`).

An adapter that forwards logical points on Android would miss. The existing
`adb` backend already performs that conversion. agent-device does not remove
it.

What adopting it as the device backend would replace, and should not:

- The XCTest and instrumentation companions, which are the confidence path
  (`docs/CI.md`, `docs/TOUCH-BACKEND-TASKS.md`). Their protocols are a
  WebSocket (iOS) and HTTP (Android) of `tap` / `down` / `move` / `up` /
  `swipe` / `longPress` / `typeText`. agent-device's runner is a different
  XCTest process with a different protocol and a different bundle id.
- Metro and launch. The runner plans Metro, `expo` / `xcodebuild`, and `adb`
  (`packages/runner/src/plan/ios.ts`, `packages/runner/src/plan/android.ts`).
  agent-device has `client.metro.prepare` / `reload` and `client.apps.open`
  (`website/docs/docs/client-api.md`). Two launchers for one app will fight
  over the foreground app and the Metro port.
- CDP locators. agent-device's React Native commands talk to the DevTools
  daemon on port 8097 for component internals (commands doc, "React Native
  component internals"). The driver's locators use the in-app view-tree
  module over CDP. Those trees are not interchangeable.
- `device.files`. Already `simctl` / `devicectl` / `adb`, with tests. An
  agent-device session is a second owner of the same device.

`CliTouchBackend` with `idb` remains the change that fills the documented
hole: iOS-only, coordinate HID, no daemon inside the driver process, no
engines bump. The task list is `docs/TOUCH-BACKEND-TASKS.md` ("iOS (idb)"),
`ROADMAP.md` tier 3, and `TODO.md`. `ROADMAP.md` marks Android `adb` CLI and
instrumentation smoke tests done, and leaves native-module device coverage
open. `TODO.md` still lists device-backed smoke coverage for
`@unrulysystems/rn-driver-touch` on iOS DEBUG and Android Instrumentation.
`docs/TOUCH-BACKEND-TASKS.md` still lists companion integration tests as
unchecked. agent-device does not implement that injector.

## Proof of concept

`spikes/agent-device-touch` depends on `agent-device@0.21.25` and is not a
workspace package. `src/map-touch.ts` types `tapAt`, `longPressAt`,
`swipeBetween`, and `typeFocusedText` against the published client, and
exports `streamingPointerMethodsAreAbsent` as a tuple of `true` that fails
to compile if `interactions` gains `down`, `move`, or `up`.

Checked inside `nix develop` on this Linux VM:

- `nub` 0.2.3 from the flake.
- `nub node install` installed Node 24.17.0 from `.node-version`
  (`nub node which` → `~/.cache/nub/node/24.17.0/bin/node`).
- `npm install` and `npx tsc --noEmit` in `spikes/agent-device-touch` exited 0. The `tsc` process was Node v22.14.0 (`/exec-daemon/node`), which meets
  agent-device's `>=22.12` floor. The compiler is checking the published
  `.d.ts` files; it does not execute the daemon.

The mapping does not start a session, connect to a daemon, or apply the
Android pixel conversion. It is evidence about types, not about a device.

## What did not run

- iOS Simulator and physical iOS. The host is Linux. agent-device's runner
  needs Xcode.
- Android emulator. `/dev/kvm` is present. No Android SDK system image was
  installed. An emulator would exercise agent-device's ADB path, which
  overlaps `CliTouchBackend`, and would not exercise the XCTest runner or
  signing. It was not started.
- `nix develop` on Darwin.
- `agent-device doctor`, the daemon, and any `xcodebuild` of
  `AgentDeviceRunner`.
- The repo's `nub run check` suite. This change does not modify a published
  package. The spike is typechecked on its own.

## Sources

- This repo at `dd186292115069fdb8972d3289ea3cbf6178ac83`: `SPEC.md` is
  unchanged by this spike. Architecture and backlog citations are the files
  named above.
- agent-device source read from a shallow clone of `main` at
  `da46f4c1c248c22047dc607cb0979e8220e1a223` (2026-10-11,
  `docs: drop version-history narration from user docs (#3427)`).
  Package under test: npm `agent-device@0.21.25` (registry `dist-tags.latest`
  on 2026-10-11; GitHub release published 2026-10-11T11:49:42Z). The clone's
  `package.json` version is `0.21.26-dev`, one nightly ahead of that tag.
- idb docs: `https://raw.githubusercontent.com/facebook/idb/main/website/docs/idb/ui.mdx`
  and the repository README, fetched 2026-10-11. GitHub repo metadata and
  releases from `GET /repos/facebook/idb` the same day.
- GitHub repo metadata, releases, and contributors:
  `GET /repos/callstack/agent-device`, `GET /repos/callstack/agent-device/releases`,
  paginated `GET /repos/{owner}/{repo}/contributors?per_page=100`.
- Commit activity: `GET /search/commits?q=repo:{owner}/{repo}+committer-date:>2026-07-13`.
- npm: `GET https://registry.npmjs.org/agent-device` and
  `GET https://registry.npmjs.org/agent-device/0.21.25`.
