import { describe, expect, it } from 'vitest'
import { configFixture, iosDevClientConfigFixture } from './fixtures'
import { ConfigValidationError, assertValid, validateConfig } from './validate'

describe('validateConfig', () => {
  it('accepts a valid full config for both platforms', () => {
    expect(validateConfig(configFixture(), ['ios', 'android'])).toEqual({ ok: true, errors: [] })
  })

  it('rejects a non-object config', () => {
    const result = validateConfig(null, ['ios'])
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('config: expected an object')
  })

  it('requires the selected platform to be configured', () => {
    const result = validateConfig({ ios: configFixture().ios }, ['ios', 'android'])
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(
      expect.stringContaining('config.android: required when platform "android" is selected'),
    )
  })

  it('does not require an unselected platform', () => {
    const result = validateConfig({ ios: configFixture().ios }, ['ios'])
    expect(result.ok).toBe(true)
  })

  it('reports missing required ios fields by name', () => {
    const result = validateConfig({ ios: { launch: { mode: 'launch', kind: 'plain' } } }, ['ios'])
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.stringContaining('config.ios.bundleId: required'))
    expect(result.errors).toContainEqual(expect.stringContaining('config.ios.workspace: required'))
    expect(result.errors).toContainEqual(expect.stringContaining('config.ios.appScheme: required'))
  })

  it('flags unknown keys as typo protection', () => {
    const config = configFixture()
    const result = validateConfig({ ...config, ios: { ...config.ios, bundleID: 'typo' } }, ['ios'])
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(
      expect.stringContaining('config.ios.bundleID: unknown key'),
    )
  })

  it('enforces the dev-client attach-mode constraint (#21)', () => {
    const config = configFixture({
      ios: iosDevClientConfigFixture({ launch: { mode: 'launch', kind: 'expo-dev-client' } }),
    })
    const result = validateConfig(config, ['ios'])
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.stringContaining('requires mode "attach"'))
  })

  it('accepts a dev-client config in attach mode', () => {
    const config = configFixture({ ios: iosDevClientConfigFixture() })
    expect(validateConfig(config, ['ios']).ok).toBe(true)
  })

  it('rejects a plain app in attach mode (no launch step would run)', () => {
    const config = configFixture({
      ios: { ...configFixture().ios!, launch: { mode: 'attach', kind: 'plain' } },
    })
    const result = validateConfig(config, ['ios'])
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(
      expect.stringContaining('mode "attach" requires kind "expo-dev-client"'),
    )
  })

  it('rejects an invalid launch mode', () => {
    const config = configFixture()
    const result = validateConfig(
      { ...config, android: { ...config.android, launch: { mode: 'bogus', kind: 'plain' } } },
      ['android'],
    )
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(
      expect.stringContaining('config.android.launch.mode: expected one of'),
    )
  })

  it('rejects an out-of-range companion port', () => {
    const config = configFixture()
    const result = validateConfig(
      { ...config, ios: { ...config.ios, companion: { port: 99_999 } } },
      ['ios'],
    )
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(
      expect.stringContaining('config.ios.companion.port: expected a port'),
    )
  })

  it('REQ-SEC: rejects a packageName with shell metacharacters (adb-shell injection)', () => {
    const config = configFixture()
    // A quote would break out of the single-quoted `run-as <pkg> sh -c '…'` script.
    const evil = "com.app'; touch /tmp/pwned; echo '"
    const result = validateConfig(
      { ...config, android: { ...config.android, packageName: evil } },
      ['android'],
    )
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(
      expect.stringContaining(
        'config.android.packageName: expected a valid Android application id',
      ),
    )
  })

  it('rejects a non-dotted packageName and a metacharacter-laden activity', () => {
    const config = configFixture()
    const result = validateConfig(
      {
        ...config,
        android: { ...config.android, packageName: 'nodots', activity: '.Main;rm -rf /' },
      },
      ['android'],
    )
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(
      expect.stringContaining(
        'config.android.packageName: expected a valid Android application id',
      ),
    )
    expect(result.errors).toContainEqual(
      expect.stringContaining('config.android.activity: expected an activity name'),
    )
  })

  it('rejects non-primitive ios.defaults values', () => {
    const config = configFixture()
    const result = validateConfig(
      { ...config, ios: { ...config.ios, defaults: { good: true, bad: { nested: 1 } } } },
      ['ios'],
    )
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(
      expect.stringContaining('config.ios.defaults.bad: expected string|number|boolean'),
    )
  })

  it('accepts string/number/boolean ios.defaults values', () => {
    const config = configFixture()
    const result = validateConfig(
      {
        ...config,
        ios: { ...config.ios, defaults: { a: 'x', b: 3, c: false } },
      },
      ['ios'],
    )
    expect(result.ok).toBe(true)
  })
})

describe('assertValid', () => {
  it('throws ConfigValidationError with the error list on invalid config', () => {
    expect(() => assertValid({}, ['ios'])).toThrow(ConfigValidationError)
    try {
      assertValid({}, ['ios'])
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError)
      expect((error as ConfigValidationError).errors.length).toBeGreaterThan(0)
    }
  })

  it('passes for a valid config', () => {
    expect(() => assertValid(configFixture(), ['ios', 'android'])).not.toThrow()
  })
})
