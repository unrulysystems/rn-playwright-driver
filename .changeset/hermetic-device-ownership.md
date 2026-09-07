---
'@unrulysystems/rn-playwright-driver-runner': minor
---

Own the device and the companion port; fail closed on anything else (REQ-OWN-001..005).

**Breaking for runs without `--device`.** The runner previously adopted the first
booted emulator / newest booted iPhone, terminated the app bundle on every other
booted simulator, and killed whatever held the companion port. On a host running
more than one lane, that silently corrupted another run's devices. Each of those
behaviours is now off by default and restored by one named opt-in:

- `ios.adoptUnownedDevice` / `android.adoptUnownedDevice` — adopt a booted device
  when `--device` is absent. Without it, the run fails at stage `device` naming
  the candidates it will not choose.
- `ios.terminateOnOtherSimulators` — terminate the app bundle on other booted
  simulators. Without it, only the selected simulator is touched. When on, the
  terminates are explicit `ios.terminate-other.<udid>` plan steps, visible in
  `--dry-run`.
- `ios.companion.freeUnownedPort` / `android.companion.freeUnownedPort` — free the
  companion port even when its holder cannot be attributed to the selected target.
  Without it, a foreign holder fails the run naming its pid and command, and
  nothing is killed.

A single-user machine restores the old behaviour by setting `adoptUnownedDevice`
on the platforms it uses; a shared host should pass `--device` instead.

Also: the companion port is now checked as the first `device`-stage step, before
prebuild/xcodebuild/Gradle, so a port conflict fails before any build or install
rather than after; and `adb forward` uses `--no-rebind` so it cannot silently
steal another lane's forward.
