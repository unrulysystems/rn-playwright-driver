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
  bundleId: string,
): Record<string, string> {
  return {
    [ENV.touchBackend]: TOUCH_BACKEND.ios,
    [ENV.metroUrl]: metro.url,
    // Metro reports iOS simulator targets by simulator name, but physical iOS
    // targets do not expose CoreDevice's user-facing device name. Emitting it
    // would make CDP selection miss the runtime the runner just launched.
    ...(resolved.kind === 'simulator' ? { [ENV.deviceName]: resolved.deviceName } : {}),
    [ENV.timeout]: String(timeoutMs ?? DEFAULTS.driverTimeoutMs),
    [ENV.xctestPort]: String(resolved.touchPort),
    [ENV.xctestTokenFile]: resolved.tokenFile,
    ...(resolved.kind === 'device'
      ? { [ENV.xctestRequestTimeout]: String(DEFAULTS.iosPhysicalXctestRequestTimeoutMs) }
      : {}),
    // File-I/O targeting (device.files). RN_SIM_UDID is the published driver env
    // name for both simulator and provisional devicectl targeting; RN_IOS_TARGET_KIND
    // selects the transport.
    [ENV.appBundleId]: bundleId,
    [ENV.simUdid]: resolved.id,
    [ENV.iosTargetKind]: resolved.kind,
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
  packageName: string,
): Record<string, string> {
  return {
    [ENV.touchBackend]: TOUCH_BACKEND.android,
    [ENV.metroUrl]: metro.url,
    [ENV.deviceName]: deviceName,
    [ENV.androidSerial]: resolved.serial,
    [ENV.timeout]: String(timeoutMs ?? DEFAULTS.driverTimeoutMs),
    [ENV.instrumentationPort]: String(resolved.touchPort),
    [ENV.instrumentationTokenFile]: resolved.tokenFile,
    // File-I/O targeting (device.files) — the adb serial already flows via
    // ANDROID_SERIAL above; add the app package for `run-as`.
    [ENV.appPackage]: packageName,
  }
}
