import type { AndroidConfig, IosConfig, MetroConfig } from '../config'
import { DEFAULTS, SECRET_PLACEHOLDER } from '../constants'

/**
 * Runtime-resolved values the pure planners consume. On a real run the
 * effectful resolver fills these in (simulator/emulator selection, minted
 * `0600` token files, probed Metro port). For `--dry-run` the resolver is
 * replaced by {@link placeholderMetro}/{@link placeholderIos}/{@link placeholderAndroid},
 * which fill the same fields with inert placeholders so planning stays pure and
 * side-effect-free.
 */
export interface ResolvedMetro {
  readonly url: string
  readonly host: string
  readonly port: number
  readonly command: string | undefined
  readonly reuseExisting: boolean
  readonly readyTimeoutMs: number
}

export interface ResolvedIosTarget {
  readonly simUdid: string
  readonly simName: string
  readonly destination: string
  readonly uitestScheme: string
  readonly touchPort: number
  readonly companionReadyTimeoutMs: number
  readonly hermesTimeoutMs: number
  /** Path to the per-run `0600` token file (value never appears in the plan). */
  readonly tokenFile: string
  /** Path to the per-run companion runtime-config JSON. */
  readonly runtimeConfigFile: string
  /**
   * Absolute path to the `rn-driver-xctest-scaffold` entry, resolved hoist-safely
   * from the project cwd (works in Yarn-berry monorepos where the bin is hoisted to
   * the repo root). Spawned as `node <scaffoldBin>`.
   */
  readonly scaffoldBin: string
  /** Metro URL handed to the dev launcher (`simctl launch --initialUrl`). */
  readonly initialUrl: string
}

export interface ResolvedAndroidTarget {
  readonly serial: string
  readonly touchPort: number
  readonly companionReadyTimeoutMs: number
  readonly hermesTimeoutMs: number
  /** Host path to the per-run `0600` token file. */
  readonly tokenFile: string
  /** Filename the token is installed under in the app's private `files/` dir. */
  readonly deviceTokenFileName: string
  readonly instrumentationTarget: string
  /** Metro URL handed to the dev launcher deep link. */
  readonly initialUrl: string
}

export function resolveMetro(
  metro: MetroConfig | undefined,
  overrides: { url?: string; host?: string; port?: number } = {},
): ResolvedMetro {
  const host = overrides.host ?? metro?.host ?? DEFAULTS.metroHost
  const fromUrl = parseMetroUrl(overrides.url ?? metro?.url)
  const port = fromUrl?.port ?? overrides.port ?? metro?.port ?? DEFAULTS.metroPort
  const resolvedHost = fromUrl?.host ?? host
  const url = fromUrl?.url ?? `http://${resolvedHost}:${port}`
  return {
    url,
    host: resolvedHost,
    port,
    command: metro?.command,
    reuseExisting: metro?.reuseExisting ?? false,
    readyTimeoutMs: metro?.readyTimeoutMs ?? DEFAULTS.metroReadyTimeoutMs,
  }
}

function parseMetroUrl(
  raw: string | undefined,
): { url: string; host: string; port: number } | undefined {
  if (!raw) return undefined
  const parsed = new URL(raw)
  const port = parsed.port
    ? Number.parseInt(parsed.port, 10)
    : parsed.protocol === 'https:'
      ? 443
      : 80
  return { url: raw.replace(/\/$/, ''), host: parsed.hostname, port }
}

export function uitestScheme(ios: IosConfig): string {
  return ios.uitestScheme ?? `${ios.appScheme}UITests`
}

export function instrumentationTarget(android: AndroidConfig): string {
  return (
    android.instrumentationTarget ?? `${android.packageName}.test/${DEFAULTS.instrumentationClass}`
  )
}

/** Dry-run resolver: same fields, inert placeholders, no I/O. */
export function placeholderIos(ios: IosConfig, metro: ResolvedMetro): ResolvedIosTarget {
  return {
    simUdid: '<sim-udid>',
    simName: '<sim-name>',
    destination: ios.destination ?? 'platform=iOS Simulator,id=<sim-udid>',
    uitestScheme: uitestScheme(ios),
    touchPort: ios.companion?.port ?? DEFAULTS.companionPort,
    companionReadyTimeoutMs: ios.companion?.readyTimeoutMs ?? DEFAULTS.iosCompanionReadyTimeoutMs,
    hermesTimeoutMs: DEFAULTS.hermesTargetTimeoutMs,
    tokenFile: SECRET_PLACEHOLDER,
    runtimeConfigFile: '<runtime-config>',
    scaffoldBin: '<scaffold-bin>',
    initialUrl: ios.launch.initialUrl ?? metro.url,
  }
}

export function placeholderAndroid(
  android: AndroidConfig,
  metro: ResolvedMetro,
): ResolvedAndroidTarget {
  return {
    serial: '<android-serial>',
    touchPort: android.companion?.port ?? DEFAULTS.companionPort,
    companionReadyTimeoutMs:
      android.companion?.readyTimeoutMs ?? DEFAULTS.androidCompanionReadyTimeoutMs,
    hermesTimeoutMs: DEFAULTS.hermesTargetTimeoutMs,
    tokenFile: SECRET_PLACEHOLDER,
    deviceTokenFileName: DEFAULTS.androidTokenFileName,
    instrumentationTarget: instrumentationTarget(android),
    initialUrl: android.launch.initialUrl ?? metro.url,
  }
}
