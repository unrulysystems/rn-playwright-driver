---
loop: 1
id: clean-seam
objective: Close upstream issues 44 through 51 so the driver installs from Metro config under a runner-emitted marker, excludes its native modules from production prebuilds, and proves both in a CI artifact check; the example app is the reference consumer.
status: active
phase: DEV
iteration: 3
iteration_budget: 14
updated_at: 2026-09-05T06:10:00Z
mission: native-e2e-clean-seam
targets:
  spec:
    [
      REQ-SEAM-001,
      REQ-SEAM-002,
      REQ-SEAM-003,
      REQ-SEAM-004,
      REQ-SEAM-005,
      REQ-SEAM-006,
      REQ-SEAM-007,
      REQ-SEAM-008,
      REQ-SEAM-009,
      REQ-SEAM-010,
      REQ-SEAM-011,
    ]
  brief: [Release footprint, Consumer footprint, Live e2e, Idle cost, Harness check, Docs alignment]
  mission: [SEAM-001, SEAM-002, SEAM-003, SEAM-004]
gates:
  - id: check
    run: nub run check
    green: typecheck, lint, format, and unit tests exit 0 at the repo root
    state: green
  - id: build
    run: nub run build
    green: every package builds
    state: green
  - id: footprint
    run: cd examples/basic-app && nub run check:footprint
    green: export and prebuild are driver-free without the marker and carry the driver with it
    state: unknown
  - id: e2e-ios
    run: cd examples/basic-app && nub run test:e2e:ios -- --device rnpd-clean-seam
    green: Playwright exits 0 on the simulator with the Metro-installed harness
    state: unknown
  - id: e2e-android
    run: cd examples/basic-app && nub run test:e2e:android -- --device emulator-5554
    green: Playwright exits 0 on the emulator with the Metro-installed harness
    state: unknown
  - id: bugbash
    run: fresh-participant bug bash of the consumer install per BRIEF Oracle (six tasks, severity floor major, one round)
    green: no finding at or above major
    state: unknown
units:
  - id: U1
    title: Root SPEC and BRIEF ratify the footprint contract; mission and loop committed
    targets: [REQ-SEAM-011]
    state: done
  - id: U2
    title: 'harness/dev gates on __DEV__ alone; frame counter starts lazily (#44, #49)'
    targets: [REQ-SEAM-005, REQ-SEAM-006]
    state: done
  - id: U3
    title: 'Runner emits RN_E2E=1 on prebuild and Metro steps; docs stop calling it planned (#46)'
    targets: [REQ-SEAM-001]
    state: done
  - id: U4
    title: 'Metro helper withRnDriverHarness; example app moves the harness out of index.ts (#51, #48)'
    targets: [REQ-SEAM-002, REQ-SEAM-007, REQ-SEAM-011]
    state: done
  - id: U5
    title: 'Native-module exclude plugin, marker-gated; companion plugins self-gate (#45, #46)'
    targets: [REQ-SEAM-003, REQ-SEAM-004]
    state: current
  - id: U6
    title: 'Instrumentation companion owns manifest-merge and MainApplication requirements (#47)'
    targets: [REQ-SEAM-008]
    state: pending
  - id: U7
    title: 'check:footprint script, both directions, observed red then green; CI job (#50)'
    targets: [REQ-SEAM-009, REQ-SEAM-010]
    state: pending
  - id: U8
    title: README and runner docs describe the Metro install; changesets authored
    targets: [REQ-SEAM-011]
    state: pending
  - id: U9
    title: Live e2e on simulator and emulator through the seam
    targets: [REQ-SEAM-011]
    state: pending
  - id: U10
    title: Fresh-participant bug bash of the consumer install; handoff
    targets: [REQ-SEAM-011]
    state: pending
decisions:
  - {
      date: 2026-09-05,
      call: "The Metro seam is a request-time entry swap through server.rewriteRequestUrl with a generated .expo/rn-driver-e2e-entry.js; Metro runs getModulesRunBeforeMainModule entries only when something already imports them (metro/src/lib/getAppendScripts.js), so issue 51's proposed mechanism cannot work as written.",
      status: provisional,
    }
  - {
      date: 2026-09-04,
      call: The Metro helper and the native-module plugin ship in the driver package as ./metro and app.plugin.js.,
      status: provisional,
    }
  - {
      date: 2026-09-04,
      call: The dedicated iOS simulator for this campaign is named rnpd-clean-seam; the Android target is the Pixel_7_API_35 AVD booted as emulator-5554.,
      status: provisional,
    }
blockers: []
boundary:
  - publish
  - npm-release
  - merge-tracked-ref
  - github-mutation
---

# Loop: clean seam — `bb/clean-seam`

## State

- Branch `bb/clean-seam` off `main` at `eee4d82`, tree clean before this loop. Nothing pushed.
- Baseline on aem5: `nub ci` exit 0, `nub run check` exit 0 (2026-09-05 04:00 UTC, `/tmp/rnpd/nub-check.log`).
- Host aem5 is shared: another session runs an eight-process CPU load test (cos.worktrees/1785-shim-e2e-flake) that ends on its own; two booted simulators (`send-qa-bb-aem5`, `send-qa-pr6924`) belong to other lanes and are never touched. Metro ports 8081–8085 were free at authoring.
- Issue drafts with the cited evidence are at `~/.handoffs/upstream-issues/1..8-*.md` on this host.
- Sibling checkout for the Send campaign: `/Users/allen/0xbigboss/0xsend/sendapp.worktrees/bb/native-e2e-clean-seam` consumes this checkout through yarn `portal:` resolutions until publish.

- U2 (2026-09-05): `harness/dev` now `if (__DEV__) void import(..)`; the RAF loop starts on first `getFrameCount()`. Red observed: `harness/dev.test.ts` ×2 and `harness.test.ts` "schedules no frame work on install" before the change; green after. `nub run check` green.

- U3 (2026-09-05): runner sets `RN_E2E=1` on prebuild and Metro steps; red observed on four planner tests, green after; runner docs no longer call the marker planned.
- U4 (2026-09-05): `withRnDriverHarness` in `packages/driver/src/metro.ts` (11 unit tests). Live probe on the example app (`/tmp/rnpd/probe-seam.out`): with the marker Metro bundled `.expo/rn-driver-e2e-entry.js` (714 modules) and the bundle had 2 `HARNESS_API_VERSION` hits; without it Metro bundled `index.ts` (711 modules) and 0 hits. `index.ts` imports nothing from the driver.

## Known pre-existing failures — do not chase (cited evidence only)

- None observed at authoring.
