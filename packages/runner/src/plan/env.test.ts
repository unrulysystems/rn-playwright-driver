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
      id: 'UDID-1',
      deviceName: 'iPhone 17',
      simName: 'iPhone 17',
      simUdid: 'UDID-1',
      touchPort: 9999,
    }
    expect(buildIosDriverEnv(resolved, metro, undefined, 'com.acme.app')).toEqual({
      RN_TOUCH_BACKEND: 'xctest',
      RN_METRO_URL: 'http://127.0.0.1:8081',
      RN_DEVICE_NAME: 'iPhone 17',
      RN_TIMEOUT: '30000',
      RN_TOUCH_XCTEST_PORT: '9999',
      RN_TOUCH_XCTEST_TOKEN_FILE: '/run/tok',
      // File-I/O targeting (REQ-TGT-002).
      RN_APP_BUNDLE_ID: 'com.acme.app',
      RN_SIM_UDID: 'UDID-1',
      RN_IOS_TARGET_KIND: 'simulator',
    })
  })

  it('uses the configured driver timeout', () => {
    const metro = resolveMetro(undefined)
    const resolved = placeholderIos(iosConfigFixture(), metro)
    expect(buildIosDriverEnv(resolved, metro, 60_000, 'com.acme.app').RN_TIMEOUT).toBe('60000')
  })

  it('emits physical iOS file-I/O targeting without an incompatible CDP device name', () => {
    const metro = resolveMetro({ url: 'http://127.0.0.1:8081' })
    const ios = iosConfigFixture({
      target: 'device',
      launch: {
        mode: 'attach',
        kind: 'expo-dev-client',
        initialUrl: 'http://192.168.1.10:8081',
      },
    })
    const resolved = {
      ...placeholderIos(ios, metro),
      id: '00008130-0012493614E8001C',
      deviceName: 'Roman Crystal',
    }

    expect(buildIosDriverEnv(resolved, metro, undefined, 'com.acme.app')).toEqual({
      RN_TOUCH_BACKEND: 'xctest',
      RN_METRO_URL: 'http://127.0.0.1:8081',
      RN_TIMEOUT: '30000',
      RN_TOUCH_XCTEST_PORT: '9999',
      RN_TOUCH_XCTEST_REQUEST_TIMEOUT: '30000',
      RN_TOUCH_XCTEST_TOKEN_FILE: '<token-file>',
      RN_APP_BUNDLE_ID: 'com.acme.app',
      RN_SIM_UDID: '00008130-0012493614E8001C',
      RN_IOS_TARGET_KIND: 'device',
    })
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
    expect(
      buildAndroidDriverEnv(resolved, metro, 'sdk_gphone64', undefined, 'com.acme.app'),
    ).toEqual({
      RN_TOUCH_BACKEND: 'instrumentation',
      RN_METRO_URL: 'http://127.0.0.1:8081',
      RN_DEVICE_NAME: 'sdk_gphone64',
      ANDROID_SERIAL: 'emulator-5554',
      RN_TIMEOUT: '30000',
      RN_TOUCH_INSTRUMENTATION_PORT: '9999',
      RN_TOUCH_INSTRUMENTATION_TOKEN_FILE: '/run/tok',
      // File-I/O targeting (REQ-TGT-002); serial flows via ANDROID_SERIAL.
      RN_APP_PACKAGE: 'com.acme.app',
    })
  })

  it('uses the configured driver timeout (RN_TIMEOUT bounds device.files host commands too)', () => {
    const metro = resolveMetro({ url: 'http://127.0.0.1:8081' })
    const resolved = {
      ...placeholderAndroid(androidConfigFixture(), metro),
      tokenFile: '/run/tok',
      serial: 'emulator-5554',
      touchPort: 9999,
    }
    expect(
      buildAndroidDriverEnv(resolved, metro, 'sdk_gphone64', 60_000, 'com.acme.app').RN_TIMEOUT,
    ).toBe('60000')
  })
})
