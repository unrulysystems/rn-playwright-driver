import { describe, expect, it } from 'vitest'
import type { TargetContext } from '../types'
import { FileIoError } from './errors'
import { resolveFileTarget } from './target'

/**
 * Assert a missing-target-context rejection carries the PUBLIC FileIoError code
 * UNAVAILABLE (REQ-TGT-004), not just a matching message — a raw or wrongly-coded
 * error would otherwise pass a message-only `toThrow(/.../)`.
 */
function expectUnavailable(fn: () => unknown, messageRe: RegExp): void {
  try {
    fn()
    expect.unreachable('should have thrown')
  } catch (error) {
    expect(error).toBeInstanceOf(FileIoError)
    expect((error as FileIoError).code).toBe('UNAVAILABLE')
    expect((error as FileIoError).message).toMatch(messageRe)
  }
}

describe('resolveFileTarget — iOS', () => {
  const full: TargetContext = { udid: 'UDID-1', bundleId: 'com.acme.app' }

  it('resolves a simulator target by default (REQ-TGT-005)', () => {
    expect(resolveFileTarget('ios', full)).toEqual({
      platform: 'ios',
      kind: 'simulator',
      udid: 'UDID-1',
      bundleId: 'com.acme.app',
      xcrunPath: 'xcrun',
    })
  })

  it('honors iosKind=device and an xcrun override', () => {
    const resolved = resolveFileTarget('ios', {
      ...full,
      iosKind: 'device',
      xcrunPath: '/opt/xcrun',
    })
    expect(resolved).toMatchObject({ platform: 'ios', kind: 'device', xcrunPath: '/opt/xcrun' })
  })

  it('fails closed with UNSUPPORTED for a SET-but-invalid iosKind (JS caller typo)', () => {
    // TargetContext types iosKind, but a JS caller can slip a typo past it; it must
    // not silently route to the simulator transport (parity with RN_IOS_TARGET_KIND).
    try {
      resolveFileTarget('ios', { ...full, iosKind: 'devcie' as unknown as 'device' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(FileIoError)
      expect((error as FileIoError).code).toBe('UNSUPPORTED')
      expect((error as FileIoError).message).toMatch(/invalid target.iosKind/)
    }
  })

  it('throws UNAVAILABLE naming target.udid / RN_SIM_UDID when the udid is missing', () => {
    try {
      resolveFileTarget('ios', { bundleId: 'com.acme.app' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(FileIoError)
      expect((error as FileIoError).code).toBe('UNAVAILABLE')
      expect((error as FileIoError).message).toContain('RN_SIM_UDID')
    }
  })

  it('throws UNAVAILABLE for a missing bundleId', () => {
    expectUnavailable(() => resolveFileTarget('ios', { udid: 'UDID-1' }), /RN_APP_BUNDLE_ID/)
  })

  it('throws UNAVAILABLE when no context is provided at all', () => {
    expectUnavailable(() => resolveFileTarget('ios', undefined), /RN_SIM_UDID|RN_APP_BUNDLE_ID/)
  })
})

describe('resolveFileTarget — Android', () => {
  const full: TargetContext = { serial: 'emulator-5554', packageName: 'com.acme.app' }

  it('resolves an android target with the default adb path', () => {
    expect(resolveFileTarget('android', full)).toEqual({
      platform: 'android',
      serial: 'emulator-5554',
      packageName: 'com.acme.app',
      adbPath: 'adb',
    })
  })

  it('honors an adb path override', () => {
    expect(resolveFileTarget('android', { ...full, adbPath: '/opt/adb' })).toMatchObject({
      adbPath: '/opt/adb',
    })
  })

  it('throws UNAVAILABLE naming ANDROID_SERIAL when the serial is missing', () => {
    expectUnavailable(
      () => resolveFileTarget('android', { packageName: 'com.acme.app' }),
      /ANDROID_SERIAL/,
    )
  })

  it('throws UNAVAILABLE naming RN_APP_PACKAGE when the package is missing', () => {
    expectUnavailable(
      () => resolveFileTarget('android', { serial: 'emulator-5554' }),
      /RN_APP_PACKAGE/,
    )
  })

  it('accepts a reverse-DNS package with digits and underscores', () => {
    expect(
      resolveFileTarget('android', { serial: 's', packageName: 'com.acme_co.app2' }),
    ).toMatchObject({ packageName: 'com.acme_co.app2' })
  })

  it('rejects a package name carrying shell metacharacters (injection guard)', () => {
    // packageName is interpolated into a device-side `run-as <pkg> sh -c …`.
    try {
      resolveFileTarget('android', {
        serial: 'emulator-5554',
        packageName: 'com.acme.app; touch /tmp/pwned',
      })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(FileIoError)
      expect((error as FileIoError).code).toBe('UNAVAILABLE')
      expect((error as FileIoError).message).toMatch(/invalid Android package name/)
    }
  })

  it('rejects a $() command substitution in the package name', () => {
    expect(() =>
      resolveFileTarget('android', { serial: 's', packageName: 'com.a$(id).b' }),
    ).toThrow(/invalid Android package name/)
  })

  it('rejects a single-segment package name (no dot)', () => {
    expect(() => resolveFileTarget('android', { serial: 's', packageName: 'android' })).toThrow(
      /invalid Android package name/,
    )
  })
})
