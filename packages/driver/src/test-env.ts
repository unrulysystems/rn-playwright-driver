import type { TouchBackendConfig, TouchBackendType } from './types'

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
