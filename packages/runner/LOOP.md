---
loop: 1
id: hermetic-devices
objective: The runner never adopts, writes to, or frees a device or companion port it does not own (fail-closed, one opt-in knob per resource), and sendapp gives each worktree lane its own device identity and companion port, consuming the local runner.
status: active
phase: DEV
iteration: 2
iteration_budget: 12
updated_at: 2026-09-07T20:10:00Z
targets:
  spec:
    [REQ-IOS-001, REQ-IOS-002, REQ-IOS-006, REQ-AND-001, REQ-CLEAN-002, REQ-CLI-007, REQ-METRO-003]
gates:
  - id: runner-check
    run: cd /home/ae/0xbigboss/0xsend/_work/hermetic-devices/rn-playwright-driver && nub run check
    green: typecheck + lint + format + unit tests pass for every package, including the new ownership tests
    state: green
  - id: sendapp-e2e-unit
    run: cd /home/ae/0xbigboss/0xsend/_work/hermetic-devices/sendapp/apps/expo && yarn test:e2e:rn:unit
    green: lane-identity determinism (acceptance 4), AVD-home-inside-worktree (acceptance 5 by construction), plan tests pass against the portal-linked local runner
    state: unknown
  - id: sendapp-e2e-typecheck
    run: cd /home/ae/0xbigboss/0xsend/_work/hermetic-devices/sendapp/apps/expo && yarn test:e2e:rn:typecheck
    green: tsgo --noEmit -p tsconfig.e2e.json exits 0
    state: unknown
  - id: sendapp-dry-run
    run: cd /home/ae/0xbigboss/0xsend/_work/hermetic-devices/sendapp/apps/expo && yarn test:e2e:rn:dry-run
    green: exits 0 with no device touch and renders the ownership-scoped free-port steps for both platforms
    state: unknown
units:
  - id: U1
    title: SPEC amendment REQ-OWN-* extending Metro ownership to devices and the companion port; BRIEF Decision/Never rows
    targets: [REQ-IOS-001, REQ-IOS-002, REQ-IOS-006, REQ-AND-001, REQ-CLEAN-002]
    state: done
  - id: U2
    title: Device adoption is fail-closed - no --device fails at stage device naming candidates; adoptUnownedDevice restores auto-pick (TDD on pickSimulator/pickSerial)
    targets: [REQ-IOS-001, REQ-AND-001, REQ-CLI-007]
    state: done
  - id: U3
    title: No cross-device write - terminate-on-other-simulators is opt-in (ios.terminateOnOtherSimulators)
    targets: [REQ-IOS-002]
    state: done
  - id: U4
    title: Companion port ownership - free-port carries the owner, frees only an attributable holder, fails naming a foreign holder; preflight before build; freeUnownedPort restores the kill (mock-runner TDD)
    targets: [REQ-IOS-006, REQ-CLEAN-002, REQ-METRO-003]
    state: done
  - id: U5
    title: Runner docs and example config aligned (README knobs, SPEC traceability, example app opts in with a comment)
    state: done
  - id: U6
    title: sendapp lane identity - pure module (worktree hash to AVD/sim name, console port, serial, companion port; loud collision failure; LANE_PORT_BASE-style override) with bun tests
    state: current
  - id: U7
    title: sendapp wiring - lane script boots/creates the lane device and execs the runner with --device; companion port from the lane; ANDROID_AVD_HOME in-worktree and gitignored; portal to the local runner; sendapp gates green
    state: pending
decisions:
  - { date: 2026-09-07, call: "Knob names: ios.adoptUnownedDevice, android.adoptUnownedDevice, ios.terminateOnOtherSimulators, <platform>.companion.freeUnownedPort (flat booleans, like allowProvisioningUpdates).", status: provisional }
  - { date: 2026-09-07, call: "Port-holder attribution: iOS holder argv carries the target UDID/CoreDevice id; Android ownership is the adb forward row for the serial; the adb server is never a kill target; foreign holder fails the step, nothing killed.", status: provisional }
  - { date: 2026-09-07, call: "REQ-IOS-002's cross-sim terminate moves from the resolver into plan steps (ios.terminate-other.<udid>) so --dry-run shows the cross-device write when opted in.", status: provisional }
  - { date: 2026-09-07, call: "Port ownership is checked as a device-stage preflight step before prebuild/xcodebuild/Gradle (REQ-OWN-004); android.forward uses --no-rebind.", status: provisional }
  - { date: 2026-09-07, call: "The example app opts into adoptUnownedDevice on both platforms (single-user recipe) so its live gates keep running without --device.", status: provisional }
  - { date: 2026-09-07, call: "The sendapp portal resolution stays uncommitted (working tree only); the consumer commit keeps ^0.5.0 and bumps after publish.", status: provisional }
  - {
      date: 2026-09-07,
      call: "Busy companion port or unowned device fails by default; one named opt-in knob per resource restores today's behaviour (house style of metro.reuseExisting).",
      status: ratified,
    }
  - { date: 2026-09-07, call: 'Iteration budget is 12.', status: ratified }
  - {
      date: 2026-09-07,
      call: 'One campaign covers upstream and the sendapp consumer; upstream first; sendapp consumes the local runner through a portal/link resolution.',
      status: ratified,
    }
  - {
      date: 2026-09-07,
      call: 'Campaign host is ae-dev (Linux, no Xcode, no emulator image); the headless harness is the interior verifier; acceptance 1-3 are Boundary items for a Mac; no emulator or system images are installed here.',
      status: ratified,
    }
  - {
      date: 2026-09-07,
      call: "LOOP.md lives at packages/runner/LOOP.md so its nearest SPEC and BRIEF are the runner's; sendapp units carry no targets.",
      status: ratified,
    }
blockers: []
boundary:
  - publish
  - merge-tracked-ref
  - push-or-pr
  - version-bump-or-changeset
  - issue-close
  - device-or-sdk-install
  - live-device-acceptance-1-3-on-a-mac
---

# Loop: hermetic native devices — `bb/hermetic-devices`

Seeded from `_work/hermetic-devices/HANDOFF.md` (2026-09-07). Two worktrees on the same
branch name: this repo off `main` 91b250b, sendapp off `bb/native-e2e-clean-seam` 9e06957c39.

## Targets (BRIEF floors, by name; missionctl cannot resolve this BRIEF's bold floor format)

- Execution verified against a mock runner; Re-run idempotency; Config validation is
  actionable; Dry-run is side-effect-free; `nub run check` green; Lifecycle docs stay
  aligned with implemented knobs.

## State

- Nothing pushed. Both repos installed in their worktrees (`nub ci`, `yarn install`);
  sendapp's root `package.json` carries the uncommitted portal resolution and
  `node_modules/@unrulysystems/rn-playwright-driver-runner` symlinks to this package.
- Iteration 2: U2-U5 done at cdaac43 (impl) and the docs commit after it. runner-check
  gate: `nub run typecheck` + `oxlint` green, `nub run test` 228/228 (runner) with the
  driver/companion suites green, format green except the known CHANGELOG file; knip
  clean; cpd 5 clones (base had 6). `pickSimulator`/`pickSerial` are pure and refuse
  adoption without `--device`; `free-port` carries an owner everywhere; the real
  `NodeProcessRunner.freePort` (lsof+ps+adb forward --list) is exercised only at the
  Boundary on a Mac.
- Iteration 1: U1 done — SPEC gained REQ-OWN-001..005 and amended REQ-IOS-001/002/006,
  REQ-AND-001/006, REQ-CLEAN-002/004, invariants, non-goals, acceptance; BRIEF gained a
  Never row and two Decisions rows.
- Defect map (HANDOFF): `resolve.ts` `pickSimulator` step 3 / `selectSerial` adopt an
  unowned device; `terminateStaleOnOtherSims` writes to every other booted sim;
  `NodeProcessRunner.freePort` SIGTERMs whatever LISTENs on the companion port.
- Android detail found while reading: the host-side holder of a forwarded companion
  port is the adb server itself (`adb forward`), so a blind `lsof`+kill on Android
  kills the shared adb server. The planners already `forward --remove` for the
  selected serial; the free-port rule on Android is therefore "remove the forward
  for the selected serial, fail on a forward for another serial".
- Knob names (provisional, driver's call per ratified decision 1):
  `ios.adoptUnownedDevice` / `android.adoptUnownedDevice` (restores auto-pick),
  `ios.terminateOnOtherSimulators` (restores REQ-IOS-002's cross-sim terminate),
  `ios.companion.freeUnownedPort` / `android.companion.freeUnownedPort` (restores the
  unconditional kill). Flat booleans match `allowProvisioningUpdates`.
- Port-holder attribution (provisional): iOS — a LISTEN holder whose `ps -o args=`
  carries the selected simulator UDID (sim-hosted companion path) or CoreDevice id is
  owned; Android — an `adb forward --list` row for the selected serial is owned; any
  other holder fails at stage `companion` naming port, pid, command or serial.
- The portal resolution in sendapp is a working-tree-only verification device; it is
  not committed (a committed portal breaks any checkout without the sibling repo).
  The consumer commit keeps `^0.5.0`; the bump lands after publish (Boundary).

## Known pre-existing failures — do not chase (cited evidence only)

- `nub run check` fails at `oxfmt --check` on `packages/driver/CHANGELOG.md` at the base
  commit 91b250b (untouched by this branch; observed 2026-09-07 with LOOP.md untracked).
  Typecheck, lint, and `nub run test` are green at base. The runner-check gate is read
  as green when the only format finding is that file.
