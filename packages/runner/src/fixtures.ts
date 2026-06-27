import type { AndroidConfig, IosConfig, RnDriverConfig } from './config'

/**
 * Test fixtures derived from the example app's e2e recipes. Not an entry point
 * and never shipped (only `dist`/`bin` are published); imported by tests.
 */

export function iosConfigFixture(overrides: Partial<IosConfig> = {}): IosConfig {
  return {
    bundleId: 'com.unrulyfall.example',
    workspace: 'ios/example.xcworkspace',
    appScheme: 'example',
    launch: { mode: 'launch', kind: 'plain' },
    ...overrides,
  }
}

export function iosDevClientConfigFixture(overrides: Partial<IosConfig> = {}): IosConfig {
  return iosConfigFixture({
    launch: { mode: 'attach', kind: 'expo-dev-client', initialUrl: 'http://127.0.0.1:8081' },
    ...overrides,
  })
}

export function androidConfigFixture(overrides: Partial<AndroidConfig> = {}): AndroidConfig {
  return {
    packageName: 'com.unrulyfall.example',
    activity: '.MainActivity',
    launch: { mode: 'launch', kind: 'plain' },
    ...overrides,
  }
}

export function androidDevClientConfigFixture(
  overrides: Partial<AndroidConfig> = {},
): AndroidConfig {
  return androidConfigFixture({
    scheme: 'boss',
    launch: { mode: 'launch', kind: 'expo-dev-client', initialUrl: 'http://127.0.0.1:8081' },
    ...overrides,
  })
}

export function configFixture(overrides: Partial<RnDriverConfig> = {}): RnDriverConfig {
  return {
    metro: { command: 'npx expo start --localhost --port 8081' },
    ios: iosConfigFixture(),
    android: androidConfigFixture(),
    playwright: { config: 'playwright.config.ts', specs: ['e2e/integration/counter.spec.ts'] },
    ...overrides,
  }
}
