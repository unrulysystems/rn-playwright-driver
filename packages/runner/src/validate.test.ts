import { describe, expect, it } from 'vitest'
import {
  androidConfigFixture,
  androidDevClientConfigFixture,
  configFixture,
  iosConfigFixture,
  iosDevClientConfigFixture,
} from './fixtures'
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

  it('accepts a target hook function', () => {
    const result = validateConfig(
      {
        ...configFixture(),
        hooks: {
          configureTarget: () => ({ env: { playwright: { E2E_PROFILE: 'local' } } }),
        },
      },
      ['ios'],
    )
    expect(result.ok).toBe(true)
  })

  it('rejects unknown hook keys and non-function configureTarget values', () => {
    const result = validateConfig(
      {
        ...configFixture(),
        hooks: {
          configureTarget: 'not-a-function',
          beforeLaunch: () => ({}),
        },
      },
      ['ios'],
    )
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(
      expect.stringContaining('config.hooks.beforeLaunch: unknown key'),
    )
    expect(result.errors).toContainEqual(
      expect.stringContaining('config.hooks.configureTarget: expected a function'),
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

  it('rejects a plain launch kind when expo-dev-client is a project dependency (REQ-CFG-006)', () => {
    const project = {
      packageJsonPath: '/proj/package.json',
      dependencies: ['expo', 'expo-dev-client'],
    }
    const result = validateConfig(configFixture(), ['ios', 'android'], project)
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      expect.stringContaining(
        'config.ios.launch.kind: "plain" but expo-dev-client is a dependency in /proj/package.json',
      ),
      expect.stringContaining(
        'config.android.launch.kind: "plain" but expo-dev-client is a dependency in /proj/package.json',
      ),
    ])
    expect(result.errors[0]).toContain('kind "expo-dev-client" with mode "attach"')
    expect(result.errors[1]).toContain('kind "expo-dev-client" and android.scheme')
  })

  it('checks the dev-client dependency only for selected platforms (REQ-CFG-006)', () => {
    const project = { packageJsonPath: '/proj/package.json', dependencies: ['expo-dev-client'] }
    const result = validateConfig(configFixture(), ['android'], project)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('config.android.launch.kind')
  })

  it('accepts a plain launch kind when expo-dev-client is not installed (REQ-CFG-006)', () => {
    const project = {
      packageJsonPath: '/proj/package.json',
      dependencies: ['expo', 'react-native'],
    }
    expect(validateConfig(configFixture(), ['ios', 'android'], project)).toEqual({
      ok: true,
      errors: [],
    })
  })

  it('accepts dev-client launch kinds when expo-dev-client is installed (REQ-CFG-006)', () => {
    const project = { packageJsonPath: '/proj/package.json', dependencies: ['expo-dev-client'] }
    const config = configFixture({
      ios: iosDevClientConfigFixture(),
      android: androidDevClientConfigFixture(),
    })
    expect(validateConfig(config, ['ios', 'android'], project)).toEqual({ ok: true, errors: [] })
  })

  it('accepts a dev-client config in attach mode', () => {
    const config = configFixture({ ios: iosDevClientConfigFixture() })
    expect(validateConfig(config, ['ios']).ok).toBe(true)
  })

  it('accepts a physical iOS dev-client config with a device-reachable launch URL', () => {
    const config = configFixture({
      ios: iosDevClientConfigFixture({
        target: 'device',
        allowProvisioningUpdates: true,
        launch: {
          mode: 'attach',
          kind: 'expo-dev-client',
          initialUrl: 'http://192.168.1.10:8081',
        },
      }),
    })
    expect(validateConfig(config, ['ios']).ok).toBe(true)
  })

  it('rejects non-boolean physical iOS provisioning updates config', () => {
    const config = configFixture({
      ios: {
        ...iosDevClientConfigFixture({
          target: 'device',
          launch: {
            mode: 'attach',
            kind: 'expo-dev-client',
            initialUrl: 'http://192.168.1.10:8081',
          },
        }),
        allowProvisioningUpdates: 'yes' as unknown as boolean,
      },
    })
    const result = validateConfig(config, ['ios'])
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(
      expect.stringContaining('config.ios.allowProvisioningUpdates: expected a boolean'),
    )
  })

  it('REQ-OWN-005: accepts the ownership opt-in keys as booleans on both platforms', () => {
    const config = configFixture({
      ios: iosConfigFixture({
        adoptUnownedDevice: true,
        terminateOnOtherSimulators: true,
        companion: { port: 9973, freeUnownedPort: true },
      }),
      android: androidConfigFixture({
        adoptUnownedDevice: true,
        companion: { port: 9973, freeUnownedPort: true },
      }),
    })
    expect(validateConfig(config, ['ios', 'android'])).toEqual({ ok: true, errors: [] })
  })

  it('REQ-OWN-005: rejects non-boolean ownership keys naming each field', () => {
    const config = configFixture({
      ios: iosConfigFixture({
        adoptUnownedDevice: 'yes' as unknown as boolean,
        terminateOnOtherSimulators: 1 as unknown as boolean,
        companion: { freeUnownedPort: 'true' as unknown as boolean },
      }),
      android: androidConfigFixture({
        adoptUnownedDevice: 'yes' as unknown as boolean,
        companion: { freeUnownedPort: 0 as unknown as boolean },
      }),
    })
    const result = validateConfig(config, ['ios', 'android'])
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('config.ios.adoptUnownedDevice: expected a boolean'),
        expect.stringContaining('config.ios.terminateOnOtherSimulators: expected a boolean'),
        expect.stringContaining('config.ios.companion.freeUnownedPort: expected a boolean'),
        expect.stringContaining('config.android.adoptUnownedDevice: expected a boolean'),
        expect.stringContaining('config.android.companion.freeUnownedPort: expected a boolean'),
      ]),
    )
  })

  it('rejects physical iOS without an explicit device-reachable launch URL', () => {
    const missing = validateConfig(
      {
        ...configFixture(),
        ios: iosDevClientConfigFixture({
          target: 'device',
          launch: { mode: 'attach', kind: 'expo-dev-client' },
        }),
      },
      ['ios'],
    )
    expect(missing.ok).toBe(false)
    expect(missing.errors).toContainEqual(
      expect.stringContaining('config.ios.launch.initialUrl: required for physical iOS devices'),
    )

    const loopback = validateConfig(
      {
        ...configFixture(),
        ios: iosDevClientConfigFixture({
          target: 'device',
          launch: {
            mode: 'attach',
            kind: 'expo-dev-client',
            initialUrl: 'http://127.0.0.1:8081',
          },
        }),
      },
      ['ios'],
    )
    expect(loopback.ok).toBe(false)
    expect(loopback.errors).toContainEqual(expect.stringContaining('cannot use localhost/loopback'))
  })

  it('requires a scheme for physical iOS expo-dev-client payload URLs', () => {
    const ios = iosDevClientConfigFixture({
      target: 'device',
      launch: {
        mode: 'attach',
        kind: 'expo-dev-client',
        initialUrl: 'http://192.168.1.10:8081',
      },
    })
    const { scheme: _scheme, ...iosWithoutScheme } = ios
    const result = validateConfig(
      {
        ...configFixture(),
        ios: iosWithoutScheme,
      },
      ['ios'],
    )
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(
      expect.stringContaining('config.ios.scheme: required for physical iOS'),
    )
  })

  it('rejects unsupported physical iOS launch and defaults combinations', () => {
    const config = configFixture({
      ios: {
        ...configFixture().ios!,
        target: 'device',
        defaults: { onboardingDone: true },
      },
    })
    const result = validateConfig(config, ['ios'])
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(
      expect.stringContaining('config.ios.target: "device" currently requires'),
    )
    expect(result.errors).toContainEqual(
      expect.stringContaining('config.ios.defaults: simulator-only'),
    )
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

  it('rejects unknown Android scheme keys as typo protection', () => {
    const config = configFixture()
    const result = validateConfig(
      { ...config, android: { ...config.android, schemes: ['boss'] } },
      ['android'],
    )
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(
      expect.stringContaining('config.android.schemes: unknown key'),
    )
  })

  it('rejects invalid Android dev-client schemes', () => {
    const config = configFixture({
      android: androidDevClientConfigFixture({ scheme: 'Boss App' }),
    })
    const result = validateConfig(config, ['android'])
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(
      expect.stringContaining('config.android.scheme: expected a valid URL scheme'),
    )
  })

  it('requires an Android scheme for expo-dev-client launch', () => {
    const config = configFixture({
      android: androidConfigFixture({
        launch: {
          mode: 'launch',
          kind: 'expo-dev-client',
          initialUrl: 'http://127.0.0.1:8081',
        },
      }),
    })
    const result = validateConfig(config, ['android'])
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(
      expect.stringContaining(
        'config.android.scheme: required when android.launch.kind is "expo-dev-client"',
      ),
    )
  })

  it('accepts an Android expo-dev-client config with a valid scheme', () => {
    const config = configFixture({ android: androidDevClientConfigFixture() })
    expect(validateConfig(config, ['android']).ok).toBe(true)
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
