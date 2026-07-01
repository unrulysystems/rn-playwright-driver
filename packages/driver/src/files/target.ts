/**
 * Resolve + validate the {@link TargetContext} a file-I/O transport needs for the
 * active platform. This is the single fail-closed gate: if the required ids are
 * missing it throws {@link FileIoError} `UNAVAILABLE` (REQ-TGT-004), naming the
 * option and the runner env var that supplies it. The resolved shape also
 * carries the transport-selection discriminant (REQ-XPORT-001 / REQ-TGT-005).
 */
import type { TargetContext } from '../types'
import { FileIoError } from './errors'

const DEFAULT_ADB_PATH = 'adb'
const DEFAULT_XCRUN_PATH = 'xcrun'

// Android package-name grammar (reverse-DNS: two or more dotted segments, each
// `[A-Za-z][A-Za-z0-9_]*` — a letter first, then letters/digits/underscores).
// The package name is interpolated into a device-side `run-as <pkg> sh -c '…'`
// script, so anything outside this grammar could inject shell commands — reject
// it at the boundary (fail-closed) rather than quote-escape.
const ANDROID_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/

/** Validated targeting, ready for a transport. iOS `kind` picks simctl vs devicectl. */
export type ResolvedFileTarget =
  | {
      readonly platform: 'ios'
      readonly kind: 'simulator' | 'device'
      readonly udid: string
      readonly bundleId: string
      readonly xcrunPath: string
    }
  | {
      readonly platform: 'android'
      readonly serial: string
      readonly packageName: string
      readonly adbPath: string
    }

function missing(field: string, optionPath: string, envVar: string): never {
  throw new FileIoError(
    'UNAVAILABLE',
    `device.files requires ${field}. Set ${optionPath} on the device options, or the ${envVar} env var the runner emits.`,
  )
}

export function resolveFileTarget(
  platform: 'ios' | 'android',
  target: TargetContext | undefined,
): ResolvedFileTarget {
  if (platform === 'ios') {
    const udid = target?.udid
    if (!udid) missing('an iOS simulator/device UDID', 'target.udid', 'RN_SIM_UDID')
    const bundleId = target?.bundleId
    if (!bundleId) missing('the app bundle id', 'target.bundleId', 'RN_APP_BUNDLE_ID')
    // Fail closed on a SET-but-invalid iosKind rather than silently defaulting to
    // simulator: `target` is a public createDevice option, so a JS caller's typo
    // ('devcie') must not misroute simctl vs devicectl — mirrors how test-env.ts
    // rejects an invalid RN_IOS_TARGET_KIND. Unset still defaults to simulator.
    const iosKind = target?.iosKind
    if (iosKind !== undefined && iosKind !== 'simulator' && iosKind !== 'device') {
      throw new FileIoError(
        'UNSUPPORTED',
        `device.files: invalid target.iosKind ${JSON.stringify(iosKind)} — expected 'simulator' or 'device'`,
      )
    }
    return {
      platform: 'ios',
      // Default to `simulator` when unset — back-compat with current sim-only runs.
      kind: iosKind === 'device' ? 'device' : 'simulator',
      udid,
      bundleId,
      xcrunPath: target?.xcrunPath ?? DEFAULT_XCRUN_PATH,
    }
  }

  const serial = target?.serial
  if (!serial) missing('an adb device serial', 'target.serial', 'ANDROID_SERIAL')
  const packageName = target?.packageName
  if (!packageName) missing('the app package name', 'target.packageName', 'RN_APP_PACKAGE')
  if (!ANDROID_PACKAGE.test(packageName)) {
    // Guard the device-shell interpolation: a crafted RN_APP_PACKAGE must not
    // smuggle shell commands into `run-as <pkg> sh -c …`. Classified UNAVAILABLE
    // (not UNSUPPORTED): the package IS present but unusable, so — like missing
    // context — no transport can run (see errors.ts UNAVAILABLE).
    throw new FileIoError(
      'UNAVAILABLE',
      `device.files: invalid Android package name ${JSON.stringify(packageName)} — expected a reverse-DNS id like com.example.app`,
    )
  }
  return {
    platform: 'android',
    serial,
    packageName,
    adbPath: target?.adbPath ?? DEFAULT_ADB_PATH,
  }
}
