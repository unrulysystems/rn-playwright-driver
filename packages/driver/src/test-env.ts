import type { TouchBackendConfig, TouchBackendType } from './types'

const DEFAULT_TOUCH_INSTRUMENTATION_PORT = 9999
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

export function parsePort(value: string | undefined): number | undefined {
  const parsed = parsePositiveInteger(value)
  return parsed === undefined || parsed > 65_535 ? undefined : parsed
}

function isTouchBackend(value: string): value is TouchBackendType {
  return TOUCH_BACKENDS.includes(value as TouchBackendType)
}

export function instrumentationAuthTokenFromEnv(
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

export function touchOptionsFromEnv(
  env: TestEnvironment,
  readTextFile: ReadTextFile,
  deviceId: string | undefined,
): TouchBackendConfig | undefined {
  const backend = env.RN_TOUCH_BACKEND
  if (!backend || !isTouchBackend(backend)) {
    return undefined
  }

  if (backend === 'cli') {
    const serial = env.RN_TOUCH_ADB_SERIAL ?? env.ANDROID_SERIAL ?? deviceId
    return {
      mode: 'force',
      backend,
      ...(serial ? { cli: { serial } } : {}),
    }
  }

  if (backend !== 'instrumentation') {
    return { mode: 'force', backend }
  }

  const authToken = instrumentationAuthTokenFromEnv(env, readTextFile)
  return {
    mode: 'force',
    backend,
    instrumentation: {
      port: parsePort(env.RN_TOUCH_INSTRUMENTATION_PORT) ?? DEFAULT_TOUCH_INSTRUMENTATION_PORT,
      ...(authToken === undefined ? {} : { authToken }),
    },
  }
}
