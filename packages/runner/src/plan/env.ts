import { DEFAULTS, ENV, TOUCH_BACKEND } from '../constants'
import type { ResolvedAndroidTarget, ResolvedIosTarget, ResolvedMetro } from './resolved'

/**
 * The driver environment-variable contract for iOS. Token material is referenced
 * by file path only (`RN_TOUCH_XCTEST_TOKEN_FILE`), never by value — matching
 * the fixture's `xctestAuthTokenFromEnv` token-file path.
 */
export function buildIosDriverEnv(
  resolved: ResolvedIosTarget,
  metro: ResolvedMetro,
  timeoutMs: number | undefined,
): Record<string, string> {
  return {
    [ENV.touchBackend]: TOUCH_BACKEND.ios,
    [ENV.metroUrl]: metro.url,
    [ENV.deviceName]: resolved.simName,
    [ENV.timeout]: String(timeoutMs ?? DEFAULTS.driverTimeoutMs),
    [ENV.xctestPort]: String(resolved.touchPort),
    [ENV.xctestTokenFile]: resolved.tokenFile,
  }
}

/**
 * The driver environment-variable contract for Android. `RN_DEVICE_NAME` is the
 * Hermes target's device name (resolved at run time); `ANDROID_SERIAL` pins adb.
 */
export function buildAndroidDriverEnv(
  resolved: ResolvedAndroidTarget,
  metro: ResolvedMetro,
  deviceName: string,
  timeoutMs: number | undefined,
): Record<string, string> {
  return {
    [ENV.touchBackend]: TOUCH_BACKEND.android,
    [ENV.metroUrl]: metro.url,
    [ENV.deviceName]: deviceName,
    [ENV.androidSerial]: resolved.serial,
    [ENV.timeout]: String(timeoutMs ?? DEFAULTS.driverTimeoutMs),
    [ENV.instrumentationPort]: String(resolved.touchPort),
    [ENV.instrumentationTokenFile]: resolved.tokenFile,
  }
}
