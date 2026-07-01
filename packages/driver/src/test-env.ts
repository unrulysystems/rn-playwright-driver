import type { IosTargetKind, TargetContext, TouchBackendConfig, TouchBackendType } from './types'

const IOS_TARGET_KINDS = ['simulator', 'device'] as const satisfies readonly IosTargetKind[]

const DEFAULT_TOUCH_INSTRUMENTATION_PORT = 9999
const DEFAULT_TOUCH_XCTEST_PORT = 9999
const TOUCH_BACKENDS = [
  'cli',
  'instrumentation',
  'native-module',
  'xctest',
] as const satisfies readonly TouchBackendType[]

export type TestEnvironment = Record<string, string | undefined>
export type ReadTextFile = (path: string) => string

/**
 * Parse a positive integer string, returning undefined if invalid.
 */
export function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed
}

function parsePort(value: string | undefined): number | undefined {
  const parsed = parsePositiveInteger(value)
  return parsed === undefined || parsed > 65_535 ? undefined : parsed
}

function isTouchBackend(value: string): value is TouchBackendType {
  return TOUCH_BACKENDS.includes(value as TouchBackendType)
}

function instrumentationAuthTokenFromEnv(
  env: TestEnvironment,
  readTextFile: ReadTextFile,
): string | undefined {
  const token = env.RN_TOUCH_INSTRUMENTATION_TOKEN
  if (token !== undefined) {
    return token
  }

  const tokenFile = env.RN_TOUCH_INSTRUMENTATION_TOKEN_FILE
  if (!tokenFile) {
    return undefined
  }

  const fileToken = readTextFile(tokenFile).trim()
  return fileToken === '' ? undefined : fileToken
}

function xctestAuthTokenFromEnv(
  env: TestEnvironment,
  readTextFile: ReadTextFile,
): string | undefined {
  const token = env.RN_TOUCH_XCTEST_TOKEN
  if (token !== undefined) {
    return token
  }

  const tokenFile = env.RN_TOUCH_XCTEST_TOKEN_FILE
  if (!tokenFile) {
    return undefined
  }

  const fileToken = readTextFile(tokenFile).trim()
  return fileToken === '' ? undefined : fileToken
}

function hasInstrumentationEnv(env: TestEnvironment): boolean {
  return (
    env.RN_TOUCH_INSTRUMENTATION_PORT !== undefined ||
    env.RN_TOUCH_INSTRUMENTATION_TOKEN !== undefined ||
    env.RN_TOUCH_INSTRUMENTATION_TOKEN_FILE !== undefined
  )
}

function hasXCTestEnv(env: TestEnvironment): boolean {
  return (
    env.RN_TOUCH_XCTEST_URL !== undefined ||
    env.RN_TOUCH_XCTEST_HOST !== undefined ||
    env.RN_TOUCH_XCTEST_PORT !== undefined ||
    env.RN_TOUCH_XCTEST_TOKEN !== undefined ||
    env.RN_TOUCH_XCTEST_TOKEN_FILE !== undefined
  )
}

function instrumentationOptionsFromEnv(
  env: TestEnvironment,
  readTextFile: ReadTextFile,
): NonNullable<TouchBackendConfig['instrumentation']> {
  const authToken = instrumentationAuthTokenFromEnv(env, readTextFile)
  return {
    port: parsePort(env.RN_TOUCH_INSTRUMENTATION_PORT) ?? DEFAULT_TOUCH_INSTRUMENTATION_PORT,
    ...(authToken === undefined ? {} : { authToken }),
  }
}

function xctestOptionsFromEnv(
  env: TestEnvironment,
  readTextFile: ReadTextFile,
): NonNullable<TouchBackendConfig['xctest']> {
  const authToken = xctestAuthTokenFromEnv(env, readTextFile)
  return {
    ...(env.RN_TOUCH_XCTEST_URL ? { url: env.RN_TOUCH_XCTEST_URL } : {}),
    ...(env.RN_TOUCH_XCTEST_HOST ? { host: env.RN_TOUCH_XCTEST_HOST } : {}),
    port: parsePort(env.RN_TOUCH_XCTEST_PORT) ?? DEFAULT_TOUCH_XCTEST_PORT,
    ...(authToken === undefined ? {} : { authToken }),
  }
}

function parseIosTargetKind(value: string | undefined): IosTargetKind | undefined {
  if (value === undefined || value === '') return undefined
  // A set-but-invalid value is a config typo. Fail closed rather than silently
  // defaulting to 'simulator', which would misroute file I/O (simctl vs devicectl).
  if (!(IOS_TARGET_KINDS as readonly string[]).includes(value)) {
    throw new Error(
      `RN_IOS_TARGET_KIND must be one of ${IOS_TARGET_KINDS.join(', ')} (got ${JSON.stringify(value)})`,
    )
  }
  return value as IosTargetKind
}

/**
 * Resolve the device/app targeting context for host-side file I/O (`device.files`)
 * from the runner's env contract. Returns undefined when no targeting env is set,
 * so a bare Playwright run without the runner simply has no `target`. The
 * fail-closed check for whether the ACTIVE platform has the fields it needs lives
 * in `resolveFileTarget` (thrown at file-op time). See SPEC.md REQ-TGT-002/003.
 */
export function targetFromEnv(env: TestEnvironment): TargetContext | undefined {
  const target: TargetContext = {}
  if (env.RN_APP_BUNDLE_ID) target.bundleId = env.RN_APP_BUNDLE_ID
  if (env.RN_APP_PACKAGE) target.packageName = env.RN_APP_PACKAGE
  // RN_SIM_UDID carries the iOS UDID for BOTH a simulator and a physical device
  // (devicectl's --device also takes a UDID). The `SIM` in the name is historical;
  // it maps to the capability-neutral `target.udid`. Kept as-is because the runner
  // and existing setups emit this exact name — renaming is a breaking env-contract
  // change, out of scope for a naming nit.
  if (env.RN_SIM_UDID) target.udid = env.RN_SIM_UDID
  // Pin the adb serial to ANDROID_SERIAL ONLY — the capability-neutral device
  // the runner launched and the driver env contract emits (SPEC.md REQ-TGT).
  // Do NOT fall back to the touch-specific RN_TOUCH_ADB_SERIAL: a stale value
  // would silently route file I/O to a different device than the app/CDP target;
  // absent ANDROID_SERIAL, leave serial unset so file ops fail closed UNAVAILABLE.
  if (env.ANDROID_SERIAL) target.serial = env.ANDROID_SERIAL
  const iosKind = parseIosTargetKind(env.RN_IOS_TARGET_KIND)
  if (iosKind) target.iosKind = iosKind
  if (env.RN_TOUCH_CLI_ADB_PATH) target.adbPath = env.RN_TOUCH_CLI_ADB_PATH
  return Object.keys(target).length > 0 ? target : undefined
}

export function touchOptionsFromEnv(
  env: TestEnvironment,
  readTextFile: ReadTextFile,
  deviceId: string | undefined,
): TouchBackendConfig | undefined {
  const backend = env.RN_TOUCH_BACKEND
  if (!backend || !isTouchBackend(backend)) {
    const config: TouchBackendConfig = {}
    if (hasInstrumentationEnv(env)) {
      config.instrumentation = instrumentationOptionsFromEnv(env, readTextFile)
    }
    if (hasXCTestEnv(env)) {
      config.xctest = xctestOptionsFromEnv(env, readTextFile)
    }
    return Object.keys(config).length > 0 ? config : undefined
  }

  if (backend === 'cli') {
    const serial = env.RN_TOUCH_ADB_SERIAL ?? env.ANDROID_SERIAL ?? deviceId
    return {
      mode: 'force',
      backend,
      ...(serial || env.RN_TOUCH_CLI_ADB_PATH
        ? {
            cli: {
              ...(env.RN_TOUCH_CLI_ADB_PATH ? { adbPath: env.RN_TOUCH_CLI_ADB_PATH } : {}),
              ...(serial ? { serial } : {}),
            },
          }
        : {}),
    }
  }

  if (backend === 'xctest') {
    return {
      mode: 'force',
      backend,
      xctest: xctestOptionsFromEnv(env, readTextFile),
    }
  }

  if (backend !== 'instrumentation') {
    return { mode: 'force', backend }
  }

  return {
    mode: 'force',
    backend,
    instrumentation: instrumentationOptionsFromEnv(env, readTextFile),
  }
}
