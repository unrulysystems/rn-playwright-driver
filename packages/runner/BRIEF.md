# BRIEF — `@unrulysystems/rn-playwright-driver-runner`

> Law doc for the RN Playwright e2e runner, present-tense, no narrated history —
> git is the changelog. Amend **Decisions** and **Boundary** only with human
> confirmation; log the rationale. Dated working memory lives in `DELTA.md` /
> `DEVIATIONS.md` beside this file. The contract (`REQ-*`, invariants) is in
> `SPEC.md`; this brief is the bar and the judge.

## Bar

A developer writes their app's facts **once** in `rn-driver.config.ts` and runs
`rn-driver test --platform all` to get a trustworthy green/red e2e result on both
iOS and Android — with no copied shell, no platform edge-case knowledge, and, on
failure, a message that names the stage that broke.

## Dimensions

- **Correctness** — the executed lifecycle produces a live Hermes target _and_ a
  reachable companion that the driver's Playwright fixture connects to and drives.
- **Unattended reliability** — no human prompt mid-run; idempotent across repeated
  runs (a crashed prior run never wedges the next).
- **Failure attribution** — a failure says _which_ stage failed (config / metro /
  device / build / companion / app-launch / hermes-target), with evidence.
- **Secret safety** — the per-run token never escapes a `0600` file into argv,
  inline env, logs, or `--dry-run` output.
- **Portability** — works for an arbitrary RN/Expo app given explicit config, not
  just the example app.
- **Faithfulness** — what `--dry-run` prints is exactly what executes; the planner
  is pure, so the audited plan is the real plan.

## Floors (the gate, not the ceiling — each with its measurement)

- **Both example e2e gates pass through the runner.** `bun run test:e2e:ios` and
  `bun run test:e2e:android` (rewired to `rn-driver test`) are green on a real
  simulator/emulator. _Measured by:_ the live e2e run (the oracle).
- **Planner is pure and unit-pinned.** `planIos`/`planAndroid` emit the expected
  ordered Steps for representative configs (both launch kinds, `--skip-build`).
  _Measured by:_ unit tests asserting the `Step[]`; same input ⇒ same plan, zero I/O.
- **Execution verified against a mock runner.** Step order, readiness gating, and
  cleanup-on-failure hold against an injected `ProcessRunner`. _Measured by:_
  integration tests with no real device.
- **Secret-safety is machine-checked.** No token value appears in any
  `CommandSpec.args`/`env` or captured log line. _Measured by:_ an assertion that
  scans the emitted plan + captured logs for the run's token value and fails if
  found.
- **Re-run idempotency.** Two consecutive runner invocations both pass with no
  manual port/process cleanup between them. _Measured by:_ a repeated-run check
  (CI-feasible for the planning/cleanup layer; live for the full gate).
- **Config validation is actionable.** Malformed/missing config fails fast naming
  the field and expected shape. _Measured by:_ unit tests over invalid configs.
- **Dry-run is side-effect-free.** `--dry-run` prints the full plan and exits 0
  having spawned nothing and touched no device. _Measured by:_ a test asserting
  the mock runner received zero effectful calls.
- **`bun run check` green** for the new package (typecheck + lint + format + unit).

## Oracle

- **Independent gate = the live example e2e.** Pass/fail is decided by the
  driver's Playwright fixture actually driving the app on a real
  simulator/emulator — _not_ by the runner inspecting itself (maker ≠ judge). The
  runner only builds the world; if the world is wrong, the fixture fails to
  connect or the specs fail.
- **Headless harness = the mock-runner integration tests + pure-planner unit
  tests**, runnable in CI without devices. These are fast, fail-closed proxies for
  the live gate; they cannot prove the _device_ behavior, only the _plan_.
- **Secret-safety oracle = the token-scan assertion** over plan + logs; it cannot
  be gamed because it searches for the actual minted token value, not a pattern
  the maker chooses.
- **Drift check:** whenever the example recipe and the runner plan are both in
  context, they must agree on lifecycle order; divergence is surfaced, not
  silently tolerated.

## Never

- A token **value** in argv, inline env (`TOKEN=… cmd`), stdout/stderr, logs, or
  `--dry-run` output. (Tokens travel by `0600` file path only.)
- A completed run (pass _or_ fail) that leaves a stale companion bound to the
  touch port, or an orphaned runner-owned Metro — i.e. wedging the next run.
- A silent fallback to a weaker touch backend when the companion is missing; a
  missing companion is a named stage failure with diagnostics.
- A mid-run human prompt (an untappable SpringBoard "Open in app?" dialog, an
  interactive Gradle/Xcode prompt). Dev-client launch uses `simctl launch
--initialUrl`, never `simctl openurl`.
- The core driver package acquiring a dependency on the runner or the companions.
- Cleanup terminating a Metro the runner did not start.
- Publishing, version-bumping, opening PRs, or filing/closing issues from the
  loop.

## Decisions (grows; every answered question lands here)

- **Separate package.** The runner is `@unrulysystems/rn-playwright-driver-runner`
  under `packages/runner`; the core driver stays orchestration-free and
  renderer-agnostic. _Why:_ CLAUDE.md "optional integrations are separate
  packages to avoid polluting the dependency tree."
- \*\*Dev-client launch = `simctl launch <udid> <bundle> --initialUrl <metro-http>`
  - terminate-first.\** Not `simctl openurl`. *Why:\* FU-1 — `openurl` trips a
    one-time untappable SpringBoard confirmation on fresh installs;
    expo-dev-launcher reads `--initialUrl` from `NSProcessInfo` with no prompt; and
    `simctl launch` ignores `--initialUrl` for an already-running instance, so the
    prior instance must be terminated first.
- **Companion readiness default 300s, configurable.** _Why:_ FU-2 — the iOS
  companion binds its port only after `xcodebuild test` finishes _building_
  (JS bundle + codesign every run); 60s expires mid-build on non-trivial apps.
- **Free the companion port (`lsof`+kill) at startup _and_ cleanup.** _Why:_ FU-3
  — killing the `xcodebuild`/`am instrument` parent does not always reap the
  sim/device-hosted child that holds the port; idempotent startup-free matters
  because a crashed run never reaches cleanup.
- **Explicit config over magic discovery (v1).** Prefer actionable validation
  errors to auto-detection of bundle id / schemes / Gradle tasks.
- **Tokens by file, never inline.** Emit `RN_TOUCH_*_TOKEN_FILE`, never
  `RN_TOUCH_*_TOKEN`. Matches the existing fixture contract and the secret-handling
  policy.
- **The runner produces the existing driver env contract** (`test-env.ts`); it
  does not fork a second driver-configuration surface.
- **Pure planner / effectful executor split.** Planning returns `Step[]` with no
  I/O; a `ProcessRunner` interface is the only OS boundary. _Why:_ this is the
  faithful, cheap, device-free harness — the whole testability story.
- **`--platform all` is sequential (v1).** Parallel multi-device is a non-goal.
- **Priority policy:** secret-safety > unattended-reliability > correctness-of-output
  > ergonomics. A secret leak or a wedging-the-next-run defect can force a
  > redesign; ergonomic polish cannot.

## Boundary (requires the human)

- **Publish** — npm release, version bump, changesets, tags.
- **Outward-facing git** — pushing, opening/merging PRs, filing or closing issues
  (including #21 and the FU-1/2/3 follow-ups).
- **Public API/package shape** — the new package, `defineRnDriverConfig`
  contract, and `rn-driver` CLI surface are gated by SPEC + plan review before
  implementation.
- **Device prerequisites** — installing Xcode/Android SDK, first-launch Xcode
  acceptance, provisioning real devices: human-attended, not the loop's job.

## Final acceptance

A developer in a _fresh_ RN/Expo app, given only the README and a filled
`rn-driver.config.ts`, runs `rn-driver test --platform all` and gets green on
both platforms without editing a single line of shell — and when something is
genuinely broken (Metro down, companion fails to build, wrong bundle id), the
runner tells them which stage failed and why. That unattended, self-diagnosing
run on a real device is the gate; the headless harness only licenses getting there.
