/**
 * Public configuration surface for the runner.
 *
 * A project provides these facts once in `rn-driver.config.ts`; the runner
 * translates them into a deterministic native-lifecycle plan per platform. The
 * shape intentionally separates the developer's *app-specific* facts (bundle
 * id, schemes, Gradle tasks, launch kind) from the *generic* lifecycle the
 * runner owns (simulator selection, Metro ownership, companion startup, token
 * passing, Hermes target wait, cleanup).
 */

export type Platform = 'ios' | 'android'

/**
 * How the app process is brought up relative to the touch companion.
 * - `launch`/`activate`: the iOS companion launches/foregrounds the app.
 * - `attach`: the companion only injects; the host owns the launch. Required for
 *   `expo-dev-client`, where the host must point the dev launcher straight at
 *   Metro (see {@link LaunchKind}).
 */
export type LaunchMode = 'launch' | 'activate' | 'attach'

/**
 * The flavor of RN app being launched.
 * - `plain`: a standard Expo/RN app that connects to Metro on cold launch.
 * - `expo-dev-client`: a development build whose launcher must be handed the
 *   Metro URL at native launch (iOS: `simctl launch --initialUrl`), otherwise it
 *   lands on the dev-launcher screen and never registers a Hermes target.
 */
export type LaunchKind = 'plain' | 'expo-dev-client'

export interface MetroConfig {
  /** Full Metro URL. When set, host/port are derived from it. */
  url?: string
  /** Command used to start Metro when it is not already running. */
  command?: string
  /** Host to bind/probe. Defaults to `127.0.0.1`. */
  host?: string
  /** Preferred port. Probed upward for a free port unless `url` pins it. */
  port?: number
  /** Reuse an already-running packager at the resolved URL instead of starting one. */
  reuseExisting?: boolean
  /** Bound for Metro `packager-status:running`. Defaults to 90_000ms. */
  readyTimeoutMs?: number
}

export interface LaunchConfig {
  mode: LaunchMode
  kind: LaunchKind
  /**
   * Metro URL handed to the dev launcher for `expo-dev-client`. Defaults to the
   * resolved Metro URL. Ignored for `plain`.
   */
  initialUrl?: string
}

export interface CompanionConfig {
  /** Local port the touch companion listens on. Defaults to 9999. */
  port?: number
  /**
   * Bound for the companion to accept its first authenticated request. Defaults
   * to 300_000ms on iOS to cover a cold `xcodebuild test` build (FU-2).
   */
  readyTimeoutMs?: number
}

export interface IosConfig {
  /** App bundle identifier, e.g. `com.company.app`. */
  bundleId: string
  /** Path to the `.xcworkspace`, e.g. `ios/App.xcworkspace`. */
  workspace: string
  /** Scheme that builds the app, e.g. `App`. */
  appScheme: string
  /** UI-test scheme. Defaults to `${appScheme}UITests`. */
  uitestScheme?: string
  /**
   * Explicit `xcodebuild` destination
   * (`platform=iOS Simulator,id=<udid>`). When omitted the runner selects a
   * booted iPhone, else the newest available iPhone runtime.
   */
  destination?: string
  launch: LaunchConfig
  companion?: CompanionConfig
  /**
   * App-specific pre-launch seeds written via `simctl spawn defaults write`
   * (e.g. dev-menu onboarding flags). Keeps app-specific facts out of the
   * generic lifecycle.
   */
  defaults?: Record<string, string | number | boolean>
}

export interface AndroidConfig {
  /** Android application id, e.g. `com.company.app`. */
  packageName: string
  /** Launch activity, e.g. `.MainActivity`. */
  activity: string
  /** Gradle tasks that build the app + androidTest APKs. */
  gradleTasks?: string[]
  /** Built app APK path. Defaults to the standard debug output path. */
  appApkPath?: string
  /** Built androidTest APK path. Defaults to the standard debug output path. */
  testApkPath?: string
  /**
   * `am instrument` target, e.g.
   * `com.company.app.test/com.rndriver.touchcompanion.RNDriverTouchCompanion`.
   * Defaults to `${packageName}.test/com.rndriver.touchcompanion.RNDriverTouchCompanion`.
   */
  instrumentationTarget?: string
  launch: LaunchConfig
  companion?: CompanionConfig
}

export interface PlaywrightConfig {
  /** Playwright config path passed as `--config`. */
  config?: string
  /** Default spec paths/globs when none are passed on the CLI. */
  specs?: string[]
}

export interface RnDriverConfig {
  metro?: MetroConfig
  ios?: IosConfig
  android?: AndroidConfig
  playwright?: PlaywrightConfig
  /** Driver request timeout (`RN_TIMEOUT`). */
  timeoutMs?: number
}

/**
 * Identity helper that provides editor/type checking for `rn-driver.config.ts`.
 * Performs no I/O.
 */
export function defineRnDriverConfig(config: RnDriverConfig): RnDriverConfig {
  return config
}
