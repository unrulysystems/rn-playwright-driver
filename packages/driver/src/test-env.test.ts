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

  it('uses the adb serial fallback order for the cli backend', () => {
    const result = touchOptionsFromEnv(
      {
        RN_TOUCH_BACKEND: 'cli',
        ANDROID_SERIAL: 'emulator-5554',
      },
      () => '',
      'metro-device-id',
    )

    expect(result).toEqual({
      mode: 'force',
      backend: 'cli',
      cli: { serial: 'emulator-5554' },
    })
  })
})
