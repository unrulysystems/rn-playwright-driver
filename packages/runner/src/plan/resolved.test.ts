import { describe, expect, it } from 'vitest'
import { androidConfigFixture, androidDevClientConfigFixture, iosConfigFixture } from '../fixtures'
import {
  instrumentationTarget,
  placeholderAndroid,
  placeholderIos,
  resolveMetro,
  uitestScheme,
} from './resolved'

describe('resolveMetro', () => {
  it('defaults to 127.0.0.1:8081', () => {
    expect(resolveMetro(undefined)).toMatchObject({
      url: 'http://127.0.0.1:8081',
      host: '127.0.0.1',
      port: 8081,
    })
  })

  it('derives host and port from an explicit url', () => {
    expect(resolveMetro({ url: 'http://10.0.0.5:8088/' })).toMatchObject({
      url: 'http://10.0.0.5:8088',
      host: '10.0.0.5',
      port: 8088,
    })
  })

  it('honors host/port and reuse flags', () => {
    expect(resolveMetro({ host: '0.0.0.0', port: 9000, reuseExisting: true })).toMatchObject({
      url: 'http://0.0.0.0:9000',
      reuseExisting: true,
    })
  })

  it('lets CLI overrides win over config', () => {
    expect(resolveMetro({ port: 8081 }, { port: 8090 })).toMatchObject({
      port: 8090,
      url: 'http://127.0.0.1:8090',
    })
  })
})

describe('scheme/target defaults', () => {
  it('defaults the UI-test scheme to <appScheme>UITests', () => {
    expect(uitestScheme(iosConfigFixture())).toBe('exampleUITests')
    expect(uitestScheme(iosConfigFixture({ uitestScheme: 'CustomUITests' }))).toBe('CustomUITests')
  })

  it('defaults the instrumentation target from the package name', () => {
    expect(instrumentationTarget(androidConfigFixture())).toBe(
      'com.unrulyfall.example.test/com.rndriver.touchcompanion.RNDriverTouchCompanion',
    )
  })
})

describe('placeholder resolvers (dry-run)', () => {
  it('iOS placeholders carry inert values and the 300s companion default', () => {
    const ios = iosConfigFixture()
    const resolved = placeholderIos(ios, resolveMetro(undefined))
    expect(resolved.tokenFile).toBe('<token-file>')
    expect(resolved.companionReadyTimeoutMs).toBe(300_000)
    expect(resolved.touchPort).toBe(9999)
  })

  it('iOS dev-client initialUrl falls back to the Metro url', () => {
    const ios = iosConfigFixture({ launch: { mode: 'attach', kind: 'expo-dev-client' } })
    const resolved = placeholderIos(ios, resolveMetro({ url: 'http://127.0.0.1:8081' }))
    expect(resolved.initialUrl).toBe('http://127.0.0.1:8081')
  })

  it('Android placeholders carry inert values and the device token filename', () => {
    const android = androidConfigFixture()
    const resolved = placeholderAndroid(android, resolveMetro(undefined))
    expect(resolved.tokenFile).toBe('<token-file>')
    expect(resolved.deviceTokenFileName).toBe('rn-driver-touch-token')
  })

  it('Android dev-client initialUrl falls back to the Metro url', () => {
    const android = androidDevClientConfigFixture({
      launch: { mode: 'launch', kind: 'expo-dev-client' },
    })
    const resolved = placeholderAndroid(android, resolveMetro({ url: 'http://127.0.0.1:8081' }))
    expect(resolved.initialUrl).toBe('http://127.0.0.1:8081')
  })

  it('Android dev-client initialUrl honors the launch override', () => {
    const android = androidDevClientConfigFixture({
      launch: {
        mode: 'launch',
        kind: 'expo-dev-client',
        initialUrl: 'http://10.0.2.2:9090',
      },
    })
    const resolved = placeholderAndroid(android, resolveMetro({ url: 'http://127.0.0.1:8081' }))
    expect(resolved.initialUrl).toBe('http://10.0.2.2:9090')
  })
})
