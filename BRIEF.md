# BRIEF — rn-playwright-driver: consumer footprint

> Law doc for the driver's consumer-facing install surface, present-tense, no
> narrated history — git is the changelog. Amend **Decisions** and **Boundary**
> only with human confirmation; the driver appends provisional Decisions, dated.
> Working memory lives in the campaign's `LOOP.md`, never here. The contract
> (`REQ-SEAM-*`) is `SPEC.md` beside this file; package briefs
> (`packages/runner/BRIEF.md`) own their own bars.

## Bar

A consumer adopts the driver with one line of Metro config and an unconditional
plugin list, runs `rn-driver test --platform all` green, and ships release
artifacts that contain none of the driver — with nothing in their app source
that mentions e2e.

## Dimensions

- **Footprint** — the app binary and app source are free of the driver outside an
  e2e build.
- **Faithfulness** — the promise is measured by an artifact check, not stated.
- **Adopter clarity** — the documented install is the only install; a consumer
  never re-derives plugin side effects.
- **Idle cost** — an installed harness does nothing until a driver asks.
- **Unattended reliability** — the live e2e is green on both platforms through
  the runner with no consumer shell.

## Floors

- Release footprint: with `RN_E2E` unset, the example app's `expo export` bundle
  contains none of `__RN_DRIVER__`, `HARNESS_API_VERSION`, or the harness's error
  strings, and its prebuild lists no `RNDriver*` module in the generated Podfile
  exclude-resolved set or in `expo-modules-autolinking resolve` for Android; with
  the marker set, both are present. Measured by `nub run check:footprint` in
  `examples/basic-app`, in both directions.
- Consumer footprint: the example app's source has no driver import and no marker
  read; its install is `withRnDriverHarness` in `metro.config.js` plus
  unconditional plugin entries. Measured by a grep in `check:footprint` over the
  app entry and app config.
- Live e2e: `nub run test:e2e:ios` and `nub run test:e2e:android` are green on a
  simulator and an emulator with the harness installed through Metro. Measured by
  the runs themselves.
- Idle cost: `installHarness` schedules no `requestAnimationFrame`. Measured by a
  harness unit test with a counting RAF stub.
- Harness check: `nub run check` (typecheck, lint, format, unit) is green at the
  repo root. Measured by the command.
- Docs alignment: README, runner README, runner SPEC, and runner BRIEF claim the
  marker as emitted only once the runner emits it, and document the Metro install
  as the install. Measured by docs-example tests plus review of the diff.

## Oracle

- **Independent gate = the artifact check and the live e2e.** `check:footprint`
  reads the exported bundle and the generated native project — the maker cannot
  pass it without the artifact actually changing, and it fails when either
  direction stops discriminating. The live e2e is decided by the driver's
  Playwright fixture driving the app on a real simulator and emulator.
- **Terminal experiential gate = a fresh-participant bug bash** of the consumer
  install: a participant who has not seen the diff adopts the driver in the
  example app from the README alone, runs the e2e on one platform, exports a
  release bundle, and reports what a consumer would hit. Severity floor: major
  (a consumer cannot complete the documented install or a release artifact
  carries the driver). Budget: one round, six tasks.
- **Headless harness = unit tests** over the Metro helper, the plugins, the
  runner planner, and the harness.

## Never

- A driver import in a consumer's app entry, or a marker read in app source, as
  the documented install.
- Harness code in a release export, or a driver native module in a production
  prebuild.
- A config plugin in this repo that changes the native project when the marker
  is unset.
- The core driver package depending on the runner or a companion.
- A token value in argv, inline env, logs, or `--dry-run` output.
- Publishing, version bumping, pushing, opening or merging PRs, or filing or
  closing issues from the loop.

## Decisions

- **The seam is `getModulesRunBeforeMainModule`, not `getPolyfills` and not an
  entry import.** Polyfills run before `InitializeCore`, too early for
  `requireNativeModule`; Expo has no per-run entry override. (2026-09-04,
  provisional — driver; from #51.)
- **The marker is `RN_E2E=1`, emitted by the runner.** It is the name the runner
  README already reserved. (2026-09-04, provisional — driver; from #46.)
- **The Metro helper and the native-module plugin live in the driver package**
  as `./metro` and `app.plugin.js`, so a consumer names one package for both. The
  package gains `@expo/config-plugins` as an optional peer, not a dependency.
  (2026-09-04, provisional — driver.)
- **#48 closes under the seam.** The helper hands Metro an absolute path; the
  `.ts` exports stay for the legacy entry import. (2026-09-04, provisional —
  driver.)
- **Priority:** footprint > faithfulness > unattended reliability > adopter
  clarity > idle cost. A footprint leak can force a redesign; ergonomics cannot.

## Boundary

- **Publish** — npm release, `changeset version`, tags. Changeset files are
  interior; running `version` or `publish` is not.
- **Outward-facing git** — pushing, opening or merging PRs, editing or closing
  issues #44–#51.
- **Device prerequisites** — Xcode, Android SDK, first-launch acceptance.

## Final acceptance

A consumer with a rule against test code in the app installs the driver from
the README, lists the plugins unconditionally, adds one Metro line, runs
`rn-driver test --platform all` green, exports a release bundle, and finds
nothing of the driver in it. That run on a real simulator and emulator is the
gate; the unit tests only license getting there.
