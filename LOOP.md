---
loop: 1
id: clean-seam
objective: Close upstream issues 44 through 51 so the driver installs from Metro config under a runner-emitted marker, excludes its native modules from production prebuilds, and proves both in a CI artifact check; the example app is the reference consumer.
status: active
phase: DEV
iteration: 10
iteration_budget: 14
updated_at: 2026-09-05T16:40:00Z
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
    state: green
  - id: e2e-ios
    run: cd examples/basic-app && node_modules/.bin/rn-driver test --platform ios --device rnpd-clean-seam
    green: Playwright exits 0 on the simulator with the Metro-installed harness
    state: green
  - id: e2e-android
    run: cd examples/basic-app && node_modules/.bin/rn-driver test --platform android --device emulator-5554
    green: Playwright exits 0 on the emulator with the Metro-installed harness
    state: green
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
    state: done
  - id: U6
    title: 'Instrumentation companion owns manifest-merge and MainApplication requirements (#47)'
    targets: [REQ-SEAM-008]
    state: done
  - id: U7
    title: 'check:footprint script, both directions, observed red then green; CI job (#50)'
    targets: [REQ-SEAM-009, REQ-SEAM-010]
    state: done
  - id: U8
    title: README and runner docs describe the Metro install; changesets authored
    targets: [REQ-SEAM-011]
    state: done
  - id: U9
    title: Live e2e on simulator and emulator through the seam
    targets: [REQ-SEAM-011]
    state: done
  - id: U10
    title: Fresh-participant bug bash of the consumer install; handoff
    targets: [REQ-SEAM-011]
    state: current
decisions:
  - {
      date: 2026-09-05,
      call: 'The runner itself marks expo-dev-menu onboarding finished for every dev-client app (ios.dev-menu, android.dev-menu; REQ-IOS-016, REQ-AND-010) instead of asking consumers to list it in ios.defaults: the sheet is a dialog window over the app that takes the first tap on both platforms, so it is a runner invariant, not an app fact. ios.defaults stays for app-specific seeds and, like the packager-host seed, is written into the app data container after the install; `simctl spawn defaults write <bundleId>` writes a simulator-wide domain the sandboxed app never reads.',
      status: provisional,
    }
  - {
      date: 2026-09-05,
      call: "The Android Hermes-target wait retries with a warm `am start` (launch-2, no force-stop); only launch-1 force-stops. Ported from the runner patch Send carried on the #6942 branch (.yarn/patches/@unrulysystems-rn-playwright-driver-runner-npm-0.4.0), so Send's replacement branch needs no patch.",
      status: provisional,
    }
  - {
      date: 2026-09-05,
      call: "Issue 47's two consumer plugins retire without replacement: the WRITE_EXTERNAL_STORAGE maxSdkVersion conflict was between Expo FileSystem and Intercom on an SDK 54 template (PixelProton codex session ad7b68c2, 2026-07-02) and the SDK 55+ template carries tools:replace; no package in this repo reads the app ReactHost, so nothing asserts ExpoReactHostFactory.",
      status: provisional,
    }
  - {
      date: 2026-09-05,
      call: "The Metro seam is a request-time entry swap through server.rewriteRequestUrl with a generated .expo/rn-driver-e2e-entry.js; Metro runs getModulesRunBeforeMainModule entries only when something already imports them (metro/src/lib/getAppendScripts.js), so issue 51's proposed mechanism cannot work as written.",
      status: provisional,
    }
  - {
      date: 2026-09-05,
      call: 'The runner-owned Metro binds the IPv4 loopback by appending --dns-result-order=ipv4first to NODE_OPTIONS (REQ-METRO-005) because Expo advertises 127.0.0.1 in the URLs it hands the app while --localhost binds whichever family the host resolves first; consumers keep their own NODE_OPTIONS through the append-only CommandSpec.appendEnv.',
      status: provisional,
    }
  - {
      date: 2026-09-05,
      call: 'Gate commands invoke node_modules/.bin/rn-driver directly: nub run forwards a literal -- to the script, which the runner reads as its Playwright passthrough separator, so --device never reached the runner and runs auto-selected the newest booted iPhone.',
      status: provisional,
    }
  - {
      date: 2026-09-05,
      call: 'An app that installs expo-dev-client is always launched as kind expo-dev-client (iOS mode attach, Android with scheme); the runner rejects kind plain for such an app at config validation (REQ-CFG-006) because a plain launch of a dev-client build only ever worked on simulators that had cached a Metro URL.',
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
- Sibling checkout for the Send campaign: `/Users/allen/0xbigboss/0xsend/sendapp.worktrees/bb/native-e2e-clean-seam` consumes this checkout through `file:` tarballs in its `.yarn/local` (packed with `nub pack` per package) until publish; repack and `yarn install` there after every driver change.

- U2 (2026-09-05): `harness/dev` now `if (__DEV__) void import(..)`; the RAF loop starts on first `getFrameCount()`. Red observed: `harness/dev.test.ts` ×2 and `harness.test.ts` "schedules no frame work on install" before the change; green after. `nub run check` green.

- U3 (2026-09-05): runner sets `RN_E2E=1` on prebuild and Metro steps; red observed on four planner tests, green after; runner docs no longer call the marker planned.
- U4 (2026-09-05): `withRnDriverHarness` in `packages/driver/src/metro.ts` (11 unit tests). Live probe on the example app (`/tmp/rnpd/probe-seam.out`): with the marker Metro bundled `.expo/rn-driver-e2e-entry.js` (714 modules) and the bundle had 2 `HARNESS_API_VERSION` hits; without it Metro bundled `index.ts` (711 modules) and 0 hits. `index.ts` imports nothing from the driver.

- U5 (2026-09-05): `packages/driver/src/plugin.ts` (`withRnDriverNativeModules`, 13 unit tests through the real `withPodfile`/`withSettingsGradle` mods) shipped as `app.plugin.js`; both companion `app.plugin.js` files return the config untouched unless `RN_E2E=1` (tests added, 8+8 green). Exclusion keys by npm package name (`expo-modules-autolinking` `findModules.js`), so the list is the four `@unrulysystems/rn-driver-*` names; SPEC REQ-SEAM-003/004 corrected. Live on the example app (SDK 56): marker off → Podfile `use_expo_modules!(exclude: [...])` and a generated `expoAutolinking.exclude` block, no companion scaffolds; marker on (non-clean prebuild) → bare call, block removed, scaffolds present; marker off again → exclusion back. `expo-modules-autolinking resolve --exclude <names>` drops all four on apple and android; `react-native-config` never lists them. `nub run check` and `nub run knip` green.

- U6 (2026-09-05): #47 traced to its source. The manifest conflict was `processDebugMainManifest` on Send's SDK 54 template (template lacked `tools:replace`; SDK 55/56 templates carry it, verified from expo/expo `sdk-54`/`sdk-55`/`sdk-56` template manifests); `androidx.test` core 1.6.1 / runner 1.6.2 / monitor 1.7.2 AAR manifests declare no storage permission. No `packages/*/android/src` file references `ReactHost`, `ReactApplication`, or `MainApplication`. Companion README gained "Native project requirements"; a test asserts the plugin returns the app manifest untouched (9 green). SPEC REQ-SEAM-008 restated accordingly. Live proof (example Android prebuild + companion run with no consumer plugin) lands with U9.

- U7 (2026-09-05): `examples/basic-app/scripts/check-footprint.mjs` (`nub run check:footprint`) green in `/tmp/rnpd/footprint-3.log`: source grep, release export ×2 (0 harness strings both states), Metro-served bundle (0 → 4/2/1 hits), clean prebuild excludes 0/4 on apple+android with no scaffolds, marked prebuild links 4/4 with both scaffolds, unmarked prebuild restores both exclusions. Observed red: a planted `RN_E2E` read in `index.ts` (`FAIL source index.ts ... found RN_E2E`), and a planted `isE2EMarked → true` (`/tmp/rnpd/footprint-planted.log`, 5 FAILs: Metro-off bundle carried the harness, both fresh-prebuild exclusions, both restores). CI job `Release footprint` added. Two script fixes along the way: `expo start --localhost` binds only `[::1]` on macOS (probe both loopbacks); the settings.gradle exclude parser must read the array after `+`.
- U8 (2026-09-05): README install is the Metro line + unconditional plugin list with a seam table; legacy harness import kept as a section; AGENTS.md constraint updated; runner README/constants and example README say the driver plugin excludes without the marker (companions inert). Changesets: driver minor, runner minor, companions minor.
- Runner (2026-09-05): `android.hermes-1` retry now uses launch-2 (no force-stop); test observed red on the pre-fix tree (1 failed) then green (15 passed).
- U9 run 1 (2026-09-05, `/tmp/rnpd/e2e-ios-1.log`, EXIT 16): `FAILED [ios] at stage [hermes-target]` after 60 s. Metro on 8083 logged no bundle request (`.expo/dev/logs/start.log` has no `metro:bundling:started` after the 8083 instantiate); the XCTest companion launched the app and idled; the simulator home screen was showing afterwards (`/tmp/rnpd/sim-after-ios-1.png`). Root cause: the example ships `expo-dev-client` (since 9d4afc6) but `rn-driver.config.ts` launched it `kind: 'plain'`; `EXDevLauncherController.start` with no `--initialUrl` reloads the last-opened URL or shows the launcher, so fresh `rnpd-clean-seam` never fetched a bundle while older simulators hid the defect. Fix in 3b264a8: example iOS `{ attach, expo-dev-client }`, Android `{ launch, expo-dev-client }` + `scheme: 'exp+example'`; runner `readProjectContext` + REQ-CFG-006 validation (observed red ×2 before the validator change, 164 runner tests green after); `nub run check` and `nub run build` green. Run 2 (`/tmp/rnpd/e2e-ios-2-dryrun.log`, `/tmp/rnpd/e2e-ios-2.log`) targeted the wrong simulator: `nub run … -- --device X` reaches the runner as `rn-driver test --platform ios -- --device X`, the `--` is the Playwright passthrough separator, so the runner auto-selected the newest booted iPhone (`iPhone 17 Pro`, 453F9188, another lane's device; the example app is now installed there and was not removed). Gate commands now call the bin directly.
- U9 by-hand reproduction on `rnpd-clean-seam` (2026-09-05): with the dev-client launch the app showed `Could not connect to development server … URL: http://127.0.0.1:8083/examples/basic-app/index.ts.bundle` (`/tmp/rnpd/sim-manual-launch.png`) while Metro listened on `[::1]:8083` only (Node 26 resolves `localhost` to `::1` first; `@expo/cli` `UrlCreator.js` rewrites `localhost` to `127.0.0.1` in advertised URLs). Restarting Metro with `NODE_OPTIONS=--dns-result-order=ipv4first` bound `127.0.0.1:8083`; the app rendered (`/tmp/rnpd/sim-manual-launch-2.png`) and `/json` listed its Hermes target. The served bundle for the manifest URL (`index.ts.bundle`, extension kept) had 0 harness strings while the virtual entry had 2: the seam compared extension-less paths only. The dev-menu onboarding sheet covered the app. All three fixed in 0fe0182 (seam test red then green; 170 runner tests; `check:footprint` now fetches the manifest-advertised URL too). Run 3 through the bin (`/tmp/rnpd/e2e-ios-3.log`): the app rendered and Playwright ran, then all 66 specs failed at connect with `Could not detect platform: CDP target carried no device identity and the Platform.OS probe failed (CDP evaluate failed: Property 'require' doesn't exist)`: `rnpd-clean-seam` carries no platform keyword, so `detectPlatform` fell through to `require('react-native')`, which Hermes does not expose; model-named simulators had hidden this. Fixed in 76cc0db: the harness reports `capabilities.platform` (Platform.OS) and the driver polls it, bounded by the device timeout (test red on the pre-fix tree 1 failed | 43 passed, green after; `nub run check` and `nub run build` green). The stray example app was uninstalled from the other lane's `iPhone 17 Pro` (453F9188; `simctl listapps` confirms absent).
- U9 run 4 (2026-09-05, `/tmp/rnpd/e2e-ios-4.log`, EXIT 0): `rnpd-clean-seam` (already Booted; simctl's 405 is tolerated), 62 passed, 4 skipped (Android-only specs), 31.8 s of Playwright. `check:footprint` re-run after the script change (`/tmp/rnpd/footprint-4.log`, EXIT 0): both the manifest-advertised `index.ts.bundle` and the virtual entry carry the harness (4/2/1 hits each); every exclusion assertion holds. Android run 1 on `emulator-5554`: `/tmp/rnpd/e2e-android-1.log`.
- Host facts (2026-09-05): the default `java` on aem5 is JDK 26, which breaks Gradle's `configureCMakeDebug` (`restricted method in java.lang.System`); the repo flake provides JDK 17 only through direnv (`.envrc` tracked and unchanged, `direnv allow` granted), so the Android gate runs as `direnv exec <repo> …`. The runner frees its companion port before starting the companion, so two lanes on one host must not share the default 9999 (the Send lane moved to 9973 after an `adb forward` collision). Send pins Node 20, which has no global WebSocket: the runner now refuses such a runtime at the config stage (REQ-CLI-008, f9f555e; test red then green) and Send runs the bin under bun. XCTest installs the app under test only when it launches it, so attach mode on a fresh simulator failed `simctl launch` with code 4: the runner installs the built product itself (REQ-IOS-015, 0655e5b; plan test red then green, 181 runner tests).
- U9 Android runs 2–6 (2026-09-05, `/tmp/rnpd/e2e-android-{2..6}.log`): prebuild, Gradle, both installs, the instrumentation companion, and the Hermes target all pass through the seam with no consumer plugin (the live proof U6 deferred); Playwright ran 66 specs with one deterministic failure, the counter spec's first tap (63/66, then 65/66 with a warm cache). Two hypotheses were disproved by logcat (touch-mode; UiAutomation connecting on the first inject; the companion change for the latter was reverted unverified). Root cause: expo-dev-menu opens its onboarding sheet at launch while `isOnboardingFinished` is unset (`DevMenuFragment.onCreate`: `showsAtLaunch || !isOnboardingFinished`; the emulator's `expo.modules.devmenu.sharedpreferences.xml` carried only `showsAtLaunch=false`). The sheet is a dialog window that inherits the activity name: `dumpsys window` showed two `MainActivity` windows for one ActivityRecord before the tap and one after (`/tmp/rnpd/android-diag-4.log`), and logcat showed the tapped window's input channel disposed (`/tmp/rnpd/android-6-logcat-full.txt:2677`). The tap only dismissed the sheet.
- U9 iOS domain defect (2026-09-05, found by the Send lane's run 5): `simctl spawn <udid> defaults write <bundleId>` writes `<sim>/data/Library/Preferences/<bundleId>.plist`, not the app container's `Library/Preferences/<bundleId>.plist` that `UserDefaults.standard` reads, so the packager-host seed and `ios.defaults` never reached the app (the example passed only because the dev-client deep link carries the Metro URL and its first specs tolerate the sheet). Fix 7d07de9: `seed-ios-defaults` action resolves the container with `simctl get_app_container` after the install and writes typed entries with the simulator's `defaults`; failures fail the run (REQ-IOS-005/010 amended, REQ-IOS-016 and REQ-AND-010 added; 7 tests red on the pre-fix tree, 190 runner tests green after; `nub run check` and `nub run build` green). A by-hand write with that command landed in the Send app's container plist (`plutil -p` shows the key).

- U9 Android green (2026-09-05, `/tmp/rnpd/android-triple-2.log`): runs 29-31 on `emulator-5554`, 64 passed / 2 skipped, EXIT 0 each. The remaining red was `scroll.spec.ts:27` failing `scrollIntoView` in 6 of 12 full-suite runs while passing in isolation (runs 10-12, 17, 22, 25 red; 18, 23, 24, 28 green). Not the dev-menu FAB and not settle timing: the failing swipe's geometry is correct (822.86 -> 91.43, the band `computeScrollGesture` derives for a 1638.48 delta, which moves the content 674 px when it lands) and the element stays at its at-rest 2434.67 for 2.2 s after the gesture (`/tmp/rnpd/e2e-android-16-diag.log`), so that swipe was swallowed whole rather than delivered late. `paths.spec.ts` + `scroll.spec.ts` reproduces; either half alone does not (`/tmp/rnpd/e2e-android-{23,24,25}*.log`), and the run right after the failure scrolls 300 px fine, so the app is not wedged. Root cause of the loss is not established and the run-to-run variance is the evidence that it is a lost gesture, not a limit; the defect fixed is that `scrollIntoView` called a scroll boundary on a single no-progress measurement, which a swallowed swipe produces exactly. Fix 1112a8d requires the no-progress observation to repeat (`NO_PROGRESS_SCROLLS_FOR_BOUNDARY`); 2 tests red on the pre-fix tree, green after; 424 driver and 190 runner tests, `nub run check` and `nub run build` green. iOS re-confirmed after the driver change on `rnpd-clean-seam` (`/tmp/rnpd/ios-pair-u10b.log`): two consecutive runs, 62 passed / 4 skipped each. `--skip-build` is not usable for the iOS gate because the Android prebuilds remove `ios/example.xcworkspace`, so it rebuilds; a lane-ordering fact, not a regression.

## Known pre-existing failures — do not chase (cited evidence only)

- None observed at authoring.
