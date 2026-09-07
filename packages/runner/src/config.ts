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

export type RunnerTarget =
  | {
      readonly platform: 'ios'
      readonly kind: 'simulator' | 'device'
      readonly id: string
      readonly deviceName: string
      readonly appId: string
      readonly metroUrl: string
    }
  | {
      readonly platform: 'android'
      readonly kind: 'emulator' | 'device'
      readonly id: string
      readonly deviceName: string
      readonly appId: string
      readonly metroUrl: string
    }

export type ProjectStepStage =
  | 'config'
  | 'metro'
  | 'device'
  | 'build'
  | 'companion'
  | 'app-launch'
  | 'hermes-target'
  | 'playwright'
  | 'cleanup'

export interface RunnerCommandSpec {
  readonly command: string
  readonly args: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
  readonly packageBin?: boolean
  readonly stdinFromFile?: string
  readonly stdinContents?: string
}

export interface ProjectCommandStep {
  readonly id: string
  readonly description: string
  readonly stage?: ProjectStepStage
  readonly command: RunnerCommandSpec
  readonly background?: boolean
  readonly processKey?: string
  readonly allowFailure?: boolean
}

export interface ProjectCleanupCommand {
  readonly description: string
  readonly command: RunnerCommandSpec
}

export interface TargetHookContribution {
  readonly env?: {
    readonly metro?: Readonly<Record<string, string>>
    readonly playwright?: Readonly<Record<string, string>>
  }
  readonly steps?: {
    readonly beforeMetro?: readonly ProjectCommandStep[]
    readonly afterMetroReady?: readonly ProjectCommandStep[]
    readonly beforeLaunch?: readonly ProjectCommandStep[]
  }
  readonly cleanup?: readonly ProjectCleanupCommand[]
}

export interface RunnerHooks {
  readonly configureTarget?: (target: RunnerTarget) => TargetHookContribution | undefined
}

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

export type IosTargetKind = 'simulator' | 'device'

export interface MetroConfig {
  /** Full Metro URL. When set, host/port are derived from it. */
  url?: string
  /** Command used to start Metro when it is not already running. */
  command?: string
  /** Host to bind/probe. Defaults to `127.0.0.1`. */
  host?: string
  /**
   * Metro port (default 8081). When the runner owns Metro it verifies this port
   * is free and fails fast if occupied — it does NOT auto-probe a different port,
   * because `command` pins the port the packager binds (REQ-METRO-003).
   */
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
   * Free the companion port even when its holder cannot be attributed to the
   * selected target (REQ-OWN-003). Defaults to false: on a shared host the
   * holder is another lane's companion, so the run fails naming it instead.
   */
  freeUnownedPort?: boolean
  /**
   * Bound for the companion to accept its first authenticated request. Defaults
   * to 300_000ms on iOS to cover a cold `xcodebuild test` build (FU-2).
   */
  readyTimeoutMs?: number
}

export interface IosConfig {
  /** App bundle identifier, e.g. `com.company.app`. */
  bundleId: string
  /** App URL scheme used for physical Expo dev-client payload URLs, e.g. `myapp`. */
  scheme?: string
  /** Path to the `.xcworkspace`, e.g. `ios/App.xcworkspace`. */
  workspace: string
  /** Scheme that builds the app, e.g. `App`. */
  appScheme: string
  /** UI-test scheme. Defaults to `${appScheme}UITests`. */
  uitestScheme?: string
  /**
   * Explicit `xcodebuild` destination
   * (`platform=iOS Simulator,id=<udid>` or `platform=iOS,id=<udid>`). When
   * omitted the runner derives the destination from the selected target.
   */
  destination?: string
  /**
   * iOS target class. Defaults to `simulator`. Physical devices are v1
   * Expo-dev-client only and require a device-reachable `launch.initialUrl`.
   */
  target?: IosTargetKind
  /**
   * Pass `-allowProvisioningUpdates` to iOS `xcodebuild` commands. Useful for
   * human-attended physical-device verification when Xcode must create/update
   * development provisioning profiles. Defaults to false.
   */
  allowProvisioningUpdates?: boolean
  /**
   * Adopt a booted simulator when `--device` is absent (REQ-OWN-001). Defaults
   * to false: on a shared host the booted simulator belongs to another run, so
   * the runner fails at stage `device` naming the candidates instead.
   */
  adoptUnownedDevice?: boolean
  /**
   * Terminate the app bundle on every OTHER booted simulator before launch
   * (REQ-IOS-002). Defaults to false: those simulators belong to other runs
   * (REQ-OWN-002); the device-name pin already disambiguates Hermes targets.
   */
  terminateOnOtherSimulators?: boolean
  launch: LaunchConfig
  companion?: CompanionConfig
  /**
   * App-specific pre-launch seeds written into the app container's
   * `NSUserDefaults` after the install (simulator only). Dev-client apps get the
   * expo-dev-menu onboarding seeds without listing them here.
   */
  defaults?: Record<string, string | number | boolean>
}

export interface AndroidConfig {
  /** Android application id, e.g. `com.company.app`. */
  packageName: string
  /** Launch activity, e.g. `.MainActivity`. */
  activity: string
  /** App URL scheme used for Expo dev-client deep links, e.g. `myapp`. */
  scheme?: string
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
  /**
   * Adopt the first booted emulator when `--device` is absent (REQ-OWN-001).
   * Defaults to false: on a shared host that emulator belongs to another run.
   */
  adoptUnownedDevice?: boolean
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
  hooks?: RunnerHooks
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
