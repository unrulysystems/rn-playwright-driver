import { describe, expect, it, vi } from 'vitest'
import { targetFromEnv, touchOptionsFromEnv } from './test-env'

describe('touchOptionsFromEnv', () => {
  it('reads instrumentation auth from a token file when the token env var is unset', () => {
    const readTextFile = vi.fn(() => ' file-token \n')

    const result = touchOptionsFromEnv(
      {
        RN_TOUCH_BACKEND: 'instrumentation',
        RN_TOUCH_INSTRUMENTATION_TOKEN_FILE: '/tmp/rn-token',
      },
      readTextFile,
      undefined,
    )

    expect(result).toEqual({
      mode: 'force',
      backend: 'instrumentation',
      instrumentation: { port: 9999, authToken: 'file-token' },
    })
    expect(readTextFile).toHaveBeenCalledWith('/tmp/rn-token')
  })

  it('prefers the direct instrumentation token env var over the token file', () => {
    const readTextFile = vi.fn(() => 'file-token')

    const result = touchOptionsFromEnv(
      {
        RN_TOUCH_BACKEND: 'instrumentation',
        RN_TOUCH_INSTRUMENTATION_TOKEN: 'env-token',
        RN_TOUCH_INSTRUMENTATION_TOKEN_FILE: '/tmp/rn-token',
      },
      readTextFile,
      undefined,
    )

    expect(result).toEqual({
      mode: 'force',
      backend: 'instrumentation',
      instrumentation: { port: 9999, authToken: 'env-token' },
    })
    expect(readTextFile).not.toHaveBeenCalled()
  })

  it('reads instrumentation companion options in automatic backend mode', () => {
    const readTextFile = vi.fn(() => ' auto-token \n')

    const result = touchOptionsFromEnv(
      {
        RN_TOUCH_INSTRUMENTATION_PORT: '7777',
        RN_TOUCH_INSTRUMENTATION_TOKEN_FILE: '/tmp/rn-token',
      },
      readTextFile,
      undefined,
    )

    expect(result).toEqual({
      instrumentation: { port: 7777, authToken: 'auto-token' },
    })
    expect(readTextFile).toHaveBeenCalledWith('/tmp/rn-token')
  })

  it('uses the adb serial fallback order for the cli backend', () => {
    const result = touchOptionsFromEnv(
      {
        RN_TOUCH_BACKEND: 'cli',
        RN_TOUCH_CLI_ADB_PATH: '/opt/android/adb',
        ANDROID_SERIAL: 'emulator-5554',
      },
      () => '',
      'metro-device-id',
    )

    expect(result).toEqual({
      mode: 'force',
      backend: 'cli',
      cli: { adbPath: '/opt/android/adb', serial: 'emulator-5554' },
    })
  })

  it('reads XCTest companion options from env', () => {
    const readTextFile = vi.fn(() => ' xctest-token \n')

    const result = touchOptionsFromEnv(
      {
        RN_TOUCH_BACKEND: 'xctest',
        RN_TOUCH_XCTEST_HOST: '127.0.0.2',
        RN_TOUCH_XCTEST_PORT: '7777',
        RN_TOUCH_XCTEST_TOKEN_FILE: '/tmp/rn-xctest-token',
      },
      readTextFile,
      undefined,
    )

    expect(result).toEqual({
      mode: 'force',
      backend: 'xctest',
      xctest: {
        host: '127.0.0.2',
        port: 7777,
        authToken: 'xctest-token',
      },
    })
    expect(readTextFile).toHaveBeenCalledWith('/tmp/rn-xctest-token')
  })

  it('prefers the XCTest URL and direct token env vars when provided', () => {
    const readTextFile = vi.fn(() => 'file-token')

    const result = touchOptionsFromEnv(
      {
        RN_TOUCH_BACKEND: 'xctest',
        RN_TOUCH_XCTEST_URL: 'ws://companion.test',
        RN_TOUCH_XCTEST_TOKEN: 'env-token',
        RN_TOUCH_XCTEST_TOKEN_FILE: '/tmp/rn-xctest-token',
      },
      readTextFile,
      undefined,
    )

    expect(result).toEqual({
      mode: 'force',
      backend: 'xctest',
      xctest: {
        url: 'ws://companion.test',
        port: 9999,
        authToken: 'env-token',
      },
    })
    expect(readTextFile).not.toHaveBeenCalled()
  })

  it('reads XCTest companion options in automatic backend mode', () => {
    const readTextFile = vi.fn(() => ' auto-xctest-token \n')

    const result = touchOptionsFromEnv(
      {
        RN_TOUCH_XCTEST_HOST: '127.0.0.1',
        RN_TOUCH_XCTEST_PORT: '8888',
        RN_TOUCH_XCTEST_TOKEN_FILE: '/tmp/rn-xctest-token',
      },
      readTextFile,
      undefined,
    )

    expect(result).toEqual({
      xctest: {
        host: '127.0.0.1',
        port: 8888,
        authToken: 'auto-xctest-token',
      },
    })
    expect(readTextFile).toHaveBeenCalledWith('/tmp/rn-xctest-token')
  })
})

describe('targetFromEnv', () => {
  it('maps the iOS file-I/O contract into a target', () => {
    expect(
      targetFromEnv({
        RN_APP_BUNDLE_ID: 'com.acme.app',
        RN_SIM_UDID: 'UDID-1',
        RN_IOS_TARGET_KIND: 'simulator',
      }),
    ).toEqual({ bundleId: 'com.acme.app', udid: 'UDID-1', iosKind: 'simulator' })
  })

  it('maps the Android contract, defaulting the serial from ANDROID_SERIAL', () => {
    expect(
      targetFromEnv({ RN_APP_PACKAGE: 'com.acme.app', ANDROID_SERIAL: 'emulator-5554' }),
    ).toEqual({ packageName: 'com.acme.app', serial: 'emulator-5554' })
  })

  it('pins the serial to ANDROID_SERIAL over a stale RN_TOUCH_ADB_SERIAL, reusing the adb path', () => {
    // ANDROID_SERIAL is the runner-launched device; a stale touch override must
    // not point file I/O at a different device (REQ-TGT).
    expect(
      targetFromEnv({
        RN_APP_PACKAGE: 'com.acme.app',
        RN_TOUCH_ADB_SERIAL: 'stale',
        ANDROID_SERIAL: 'emulator-5554',
        RN_TOUCH_CLI_ADB_PATH: '/opt/adb',
      }),
    ).toMatchObject({ serial: 'emulator-5554', adbPath: '/opt/adb' })
  })

  it('does NOT fall back to RN_TOUCH_ADB_SERIAL — leaves serial unset (fail closed)', () => {
    // A stale touch override must never become the file-I/O device; absent
    // ANDROID_SERIAL, file ops fail closed UNAVAILABLE rather than route wrong.
    const target = targetFromEnv({ RN_APP_PACKAGE: 'com.acme.app', RN_TOUCH_ADB_SERIAL: 'stale' })
    expect(target?.serial).toBeUndefined()
    expect(target).toMatchObject({ packageName: 'com.acme.app' })
  })

  it('throws on an invalid RN_IOS_TARGET_KIND (fail closed, not a silent simulator default)', () => {
    expect(() => targetFromEnv({ RN_SIM_UDID: 'UDID-1', RN_IOS_TARGET_KIND: 'nonsense' })).toThrow(
      /RN_IOS_TARGET_KIND must be one of/,
    )
  })

  it('treats an empty RN_IOS_TARGET_KIND as unset (no throw)', () => {
    expect(targetFromEnv({ RN_SIM_UDID: 'UDID-1', RN_IOS_TARGET_KIND: '' })).toEqual({
      udid: 'UDID-1',
    })
  })

  it('returns undefined when no targeting env is present', () => {
    expect(targetFromEnv({ RN_METRO_URL: 'http://localhost:8081' })).toBeUndefined()
  })
})
