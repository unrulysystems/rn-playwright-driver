import { describe, expect, it, vi } from 'vitest'
import { touchOptionsFromEnv } from './test-env'

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
