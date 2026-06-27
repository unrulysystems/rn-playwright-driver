import type { Platform, RnDriverConfig } from './config'

export interface ValidationResult {
  readonly ok: boolean
  readonly errors: readonly string[]
}

const LAUNCH_MODES = ['launch', 'activate', 'attach'] as const
const LAUNCH_KINDS = ['plain', 'expo-dev-client'] as const

const TOP_LEVEL_KEYS = new Set(['metro', 'ios', 'android', 'playwright', 'timeoutMs'])
const METRO_KEYS = new Set(['url', 'command', 'host', 'port', 'reuseExisting', 'readyTimeoutMs'])
const LAUNCH_KEYS = new Set(['mode', 'kind', 'initialUrl'])
const COMPANION_KEYS = new Set(['port', 'readyTimeoutMs'])
const IOS_KEYS = new Set([
  'bundleId',
  'workspace',
  'appScheme',
  'uitestScheme',
  'destination',
  'launch',
  'companion',
  'defaults',
])
const ANDROID_KEYS = new Set([
  'packageName',
  'activity',
  'gradleTasks',
  'appApkPath',
  'testApkPath',
  'instrumentationTarget',
  'launch',
  'companion',
])
const PLAYWRIGHT_KEYS = new Set(['config', 'specs'])

/**
 * Validate a loaded config for the selected platforms. Runs before any side
 * effect; failures name the offending field and the expected shape (REQ-CFG-003).
 * Unknown keys are reported as typo protection (REQ-CFG-004).
 */
export function validateConfig(config: unknown, platforms: readonly Platform[]): ValidationResult {
  const errors: string[] = []

  if (!isRecord(config)) {
    return {
      ok: false,
      errors: ['config: expected an object exported as default from rn-driver.config'],
    }
  }

  reportUnknownKeys('config', config, TOP_LEVEL_KEYS, errors)
  if (config.timeoutMs !== undefined && !isPositiveNumber(config.timeoutMs)) {
    errors.push('config.timeoutMs: expected a positive number')
  }
  validateMetro(config.metro, errors)
  validatePlaywright(config.playwright, errors)

  if (platforms.includes('ios')) validateIos(config.ios, errors)
  if (platforms.includes('android')) validateAndroid(config.android, errors)

  return { ok: errors.length === 0, errors }
}

function validateMetro(metro: unknown, errors: string[]): void {
  if (metro === undefined) return
  if (!isRecord(metro)) {
    errors.push('config.metro: expected an object')
    return
  }
  reportUnknownKeys('config.metro', metro, METRO_KEYS, errors)
  optionalString('config.metro.url', metro.url, errors)
  optionalString('config.metro.command', metro.command, errors)
  optionalString('config.metro.host', metro.host, errors)
  if (metro.port !== undefined && !isPort(metro.port))
    errors.push('config.metro.port: expected a port (1-65535)')
  if (metro.reuseExisting !== undefined && typeof metro.reuseExisting !== 'boolean') {
    errors.push('config.metro.reuseExisting: expected a boolean')
  }
  if (metro.readyTimeoutMs !== undefined && !isPositiveNumber(metro.readyTimeoutMs)) {
    errors.push('config.metro.readyTimeoutMs: expected a positive number')
  }
}

function validatePlaywright(playwright: unknown, errors: string[]): void {
  if (playwright === undefined) return
  if (!isRecord(playwright)) {
    errors.push('config.playwright: expected an object')
    return
  }
  reportUnknownKeys('config.playwright', playwright, PLAYWRIGHT_KEYS, errors)
  optionalString('config.playwright.config', playwright.config, errors)
  if (playwright.specs !== undefined && !isStringArray(playwright.specs)) {
    errors.push('config.playwright.specs: expected an array of strings')
  }
}

function validateIos(ios: unknown, errors: string[]): void {
  if (!isRecord(ios)) {
    errors.push('config.ios: required when platform "ios" is selected (expected an object)')
    return
  }
  reportUnknownKeys('config.ios', ios, IOS_KEYS, errors)
  requireString('config.ios.bundleId', ios.bundleId, errors)
  requireString('config.ios.workspace', ios.workspace, errors)
  requireString('config.ios.appScheme', ios.appScheme, errors)
  optionalString('config.ios.uitestScheme', ios.uitestScheme, errors)
  optionalString('config.ios.destination', ios.destination, errors)
  validateCompanion('config.ios.companion', ios.companion, errors)
  if (ios.defaults !== undefined) {
    if (!isRecord(ios.defaults)) {
      errors.push('config.ios.defaults: expected an object of key -> string|number|boolean')
    } else {
      // planIos feeds each value into `simctl defaults write`; a non-primitive
      // would stringify to `[object Object]` and write a bogus default.
      for (const [key, value] of Object.entries(ios.defaults)) {
        const kind = typeof value
        if (kind !== 'string' && kind !== 'number' && kind !== 'boolean') {
          errors.push(`config.ios.defaults.${key}: expected string|number|boolean`)
        }
      }
    }
  }
  const launch = validateLaunch('config.ios.launch', ios.launch, errors)
  if (launch && launch.kind === 'expo-dev-client' && launch.mode !== 'attach') {
    // The hard-won #21 constraint: a dev-client app launched by the companion
    // lands on the dev-launcher and never registers a Hermes target. The host
    // must own the launch, so the companion must run in attach mode.
    errors.push(
      'config.ios.launch: kind "expo-dev-client" requires mode "attach" (the host owns the launch)',
    )
  }
}

function validateAndroid(android: unknown, errors: string[]): void {
  if (!isRecord(android)) {
    errors.push('config.android: required when platform "android" is selected (expected an object)')
    return
  }
  reportUnknownKeys('config.android', android, ANDROID_KEYS, errors)
  // packageName/activity are interpolated into `adb shell run-as <pkg> sh -c '…'`
  // and `am start -n <pkg>/<activity>`; a value with shell metacharacters (e.g.
  // a quote) could break out of the single-quoted remote script and inject
  // device-shell commands. Constrain to the Android identifier grammar so no
  // metacharacter survives validation (security, defense-in-depth).
  requireAndroidPackage('config.android.packageName', android.packageName, errors)
  requireAndroidActivity('config.android.activity', android.activity, errors)
  optionalString('config.android.appApkPath', android.appApkPath, errors)
  optionalString('config.android.testApkPath', android.testApkPath, errors)
  // instrumentationTarget crosses `adb shell am instrument … -w <target>`; like
  // packageName/activity, constrain it so no shell metacharacter survives.
  if (android.instrumentationTarget !== undefined)
    requireInstrumentationTarget(
      'config.android.instrumentationTarget',
      android.instrumentationTarget,
      errors,
    )
  if (android.gradleTasks !== undefined && !isStringArray(android.gradleTasks)) {
    errors.push('config.android.gradleTasks: expected an array of strings')
  }
  validateCompanion('config.android.companion', android.companion, errors)
  validateLaunch('config.android.launch', android.launch, errors)
}

function validateCompanion(path: string, companion: unknown, errors: string[]): void {
  if (companion === undefined) return
  if (!isRecord(companion)) {
    errors.push(`${path}: expected an object`)
    return
  }
  reportUnknownKeys(path, companion, COMPANION_KEYS, errors)
  if (companion.port !== undefined && !isPort(companion.port))
    errors.push(`${path}.port: expected a port (1-65535)`)
  if (companion.readyTimeoutMs !== undefined && !isPositiveNumber(companion.readyTimeoutMs)) {
    errors.push(`${path}.readyTimeoutMs: expected a positive number`)
  }
}

function validateLaunch(
  path: string,
  launch: unknown,
  errors: string[],
): { mode: string; kind: string } | undefined {
  if (!isRecord(launch)) {
    errors.push(`${path}: required (expected an object with mode and kind)`)
    return undefined
  }
  reportUnknownKeys(path, launch, LAUNCH_KEYS, errors)
  optionalString(`${path}.initialUrl`, launch.initialUrl, errors)
  const modeOk =
    typeof launch.mode === 'string' && (LAUNCH_MODES as readonly string[]).includes(launch.mode)
  const kindOk =
    typeof launch.kind === 'string' && (LAUNCH_KINDS as readonly string[]).includes(launch.kind)
  if (!modeOk) errors.push(`${path}.mode: expected one of ${LAUNCH_MODES.join(', ')}`)
  if (!kindOk) errors.push(`${path}.kind: expected one of ${LAUNCH_KINDS.join(', ')}`)
  return modeOk && kindOk ? { mode: launch.mode as string, kind: launch.kind as string } : undefined
}

// --- primitives ---

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65_535
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function requireString(path: string, value: unknown, errors: string[]): void {
  if (typeof value !== 'string' || value.trim() === '')
    errors.push(`${path}: required non-empty string`)
}

// Dotted Android application id, e.g. `com.company.app`. Each segment starts with
// a letter; only letters, digits, and underscores — no shell metacharacters.
const ANDROID_PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/
// Activity, e.g. `.MainActivity` or `com.company.app.MainActivity`. Optional
// leading dot (relative form), then dot-joined identifier segments.
const ANDROID_ACTIVITY_RE = /^\.?[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/

function requireAndroidPackage(path: string, value: unknown, errors: string[]): void {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${path}: required non-empty string`)
    return
  }
  if (!ANDROID_PACKAGE_RE.test(value))
    errors.push(`${path}: expected a valid Android application id (e.g. com.company.app)`)
}

function requireAndroidActivity(path: string, value: unknown, errors: string[]): void {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${path}: required non-empty string`)
    return
  }
  if (!ANDROID_ACTIVITY_RE.test(value))
    errors.push(`${path}: expected an activity name (e.g. .MainActivity)`)
}

// `am instrument` target: `<pkg>.test/<runner-class>`. Identifier segments only,
// split by a single `/` — no shell metacharacters.
const ANDROID_INSTRUMENTATION_RE =
  /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*\/[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/

function requireInstrumentationTarget(path: string, value: unknown, errors: string[]): void {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${path}: expected a non-empty string`)
    return
  }
  if (!ANDROID_INSTRUMENTATION_RE.test(value))
    errors.push(`${path}: expected an am instrument target (e.g. com.app.test/com.app.Runner)`)
}

function optionalString(path: string, value: unknown, errors: string[]): void {
  if (value !== undefined && typeof value !== 'string') errors.push(`${path}: expected a string`)
}

function reportUnknownKeys(
  path: string,
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  errors: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${path}.${key}: unknown key`)
  }
}

/** Narrowing helper for callers that have already validated. */
export function assertValid(
  config: unknown,
  platforms: readonly Platform[],
): asserts config is RnDriverConfig {
  const result = validateConfig(config, platforms)
  if (!result.ok) {
    throw new ConfigValidationError(result.errors)
  }
}

export class ConfigValidationError extends Error {
  readonly errors: readonly string[]
  constructor(errors: readonly string[]) {
    super(`Invalid rn-driver config:\n  - ${errors.join('\n  - ')}`)
    this.name = 'ConfigValidationError'
    this.errors = errors
  }
}
