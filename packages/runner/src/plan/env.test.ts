import { describe, expect, it } from 'vitest'
import { androidConfigFixture, iosConfigFixture } from '../fixtures'
import { buildAndroidDriverEnv, buildIosDriverEnv } from './env'
import { placeholderAndroid, placeholderIos, resolveMetro } from './resolved'

describe('buildIosDriverEnv', () => {
  it('forces the xctest backend and references the token file', () => {
    const metro = resolveMetro({ url: 'http://127.0.0.1:8081' })
    const resolved = {
      ...placeholderIos(iosConfigFixture(), metro),
      tokenFile: '/run/tok',
      simName: 'iPhone 17',
      touchPort: 9999,
    }
    expect(buildIosDriverEnv(resolved, metro, undefined)).toEqual({
      RN_TOUCH_BACKEND: 'xctest',
      RN_METRO_URL: 'http://127.0.0.1:8081',
      RN_DEVICE_NAME: 'iPhone 17',
      RN_TIMEOUT: '30000',
      RN_TOUCH_XCTEST_PORT: '9999',
      RN_TOUCH_XCTEST_TOKEN_FILE: '/run/tok',
    })
  })

  it('uses the configured driver timeout', () => {
    const metro = resolveMetro(undefined)
    const resolved = placeholderIos(iosConfigFixture(), metro)
    expect(buildIosDriverEnv(resolved, metro, 60_000).RN_TIMEOUT).toBe('60000')
  })
})

describe('buildAndroidDriverEnv', () => {
  it('forces the instrumentation backend and pins the adb serial + device name', () => {
    const metro = resolveMetro({ url: 'http://127.0.0.1:8081' })
    const resolved = {
      ...placeholderAndroid(androidConfigFixture(), metro),
      tokenFile: '/run/tok',
      serial: 'emulator-5554',
      touchPort: 9999,
    }
    expect(buildAndroidDriverEnv(resolved, metro, 'sdk_gphone64', undefined)).toEqual({
      RN_TOUCH_BACKEND: 'instrumentation',
      RN_METRO_URL: 'http://127.0.0.1:8081',
      RN_DEVICE_NAME: 'sdk_gphone64',
      ANDROID_SERIAL: 'emulator-5554',
      RN_TIMEOUT: '30000',
      RN_TOUCH_INSTRUMENTATION_PORT: '9999',
      RN_TOUCH_INSTRUMENTATION_TOKEN_FILE: '/run/tok',
    })
  })
})
