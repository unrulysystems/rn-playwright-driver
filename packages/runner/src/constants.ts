/**
 * The driver environment-variable contract the runner produces.
 *
 * These names mirror what the Playwright fixture reads
 * (`packages/driver/src/test-env.ts` and the driver README "Configuration").
 * The runner sets these and then invokes Playwright; it does not introduce a
 * parallel driver-configuration surface. Token material is always passed by
 * file path (`*_TOKEN_FILE`), never inline (`*_TOKEN`) — see secret-handling.
 *
 * DELIBERATE: this is a local copy of the driver's `RN_*` contract, NOT an import
 * from the driver. The runner intentionally carries no npm dependency on the
 * driver (one-way, contract-level coupling — see README/SPEC), so the small set
 * of names is duplicated rather than shared. The tradeoff is silent drift if the
 * driver renames a variable; that is bounded by the contract being a published,
 * stable interface (`packages/driver/src/test-env.ts`) and is exercised by the
 * live e2e oracle, which fails if a name stops matching.
 */
export const ENV = {
  metroUrl: 'RN_METRO_URL',
  deviceId: 'RN_DEVICE_ID',
  deviceName: 'RN_DEVICE_NAME',
  timeout: 'RN_TIMEOUT',
  touchBackend: 'RN_TOUCH_BACKEND',
  xctestPort: 'RN_TOUCH_XCTEST_PORT',
  xctestTokenFile: 'RN_TOUCH_XCTEST_TOKEN_FILE',
  instrumentationPort: 'RN_TOUCH_INSTRUMENTATION_PORT',
  instrumentationTokenFile: 'RN_TOUCH_INSTRUMENTATION_TOKEN_FILE',
  androidSerial: 'ANDROID_SERIAL',
} as const

/** Touch backend forced per platform (companion-first, fail-closed). */
export const TOUCH_BACKEND = {
  ios: 'xctest',
  android: 'instrumentation',
} as const

export const DEFAULTS = {
  metroHost: '127.0.0.1',
  metroPort: 8081,
  metroReadyTimeoutMs: 90_000,
  companionPort: 9999,
  /** Covers a cold `xcodebuild test` build, not just process startup (FU-2). */
  iosCompanionReadyTimeoutMs: 300_000,
  androidCompanionReadyTimeoutMs: 45_000,
  hermesTargetTimeoutMs: 60_000,
  appLaunchAttempts: 3,
  driverTimeoutMs: 30_000,
  androidGradleTasks: [':app:assembleDebug', ':app:assembleDebugAndroidTest'],
  androidAppApkPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
  androidTestApkPath: 'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk',
  instrumentationClass: 'com.rndriver.touchcompanion.RNDriverTouchCompanion',
  /** UI-test method the iOS companion exposes as a long-running server. */
  xctestServerTest: 'RNDriverTouchCompanionTests/testRunServer',
  /** Device-private filename the Android companion reads its token from. */
  androidTokenFileName: 'rn-driver-touch-token',
} as const

/** Placeholder shown in `--dry-run` output wherever a secret file path appears. */
export const SECRET_PLACEHOLDER = '<token-file>'

/**
 * Terminal markers in a companion process's captured log that mean the build/test will NOT come up,
 * so the companion-ready probe must abort EARLY instead of waiting out the (cold-build) timeout. A
 * failed `xcodebuild test` prints `** BUILD FAILED **` / `** TEST FAILED **` and then lingers for
 * tens of seconds doing reporting/cleanup — so the process stays "alive" and the readiness probe
 * would otherwise burn the full `iosCompanionReadyTimeoutMs` (300s) before failing. `am instrument`
 * prints `INSTRUMENTATION_FAILED` / `Process crashed` when the companion cannot start. These are the
 * substrings the probe scans for; the planners attach the per-platform set to the companion-ready
 * probe step (see ios.ts / android.ts).
 */
export const COMPANION_FAILURE_MARKERS = {
  ios: ['** BUILD FAILED **', '** TEST FAILED **'],
  android: ['INSTRUMENTATION_FAILED', 'Process crashed'],
} as const
