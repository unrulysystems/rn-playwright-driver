import { describe, expect, it } from 'vitest'
import { defineRnDriverConfig } from './config'

describe('documented config examples', () => {
  it('typechecks the README-style config shape against the public helper', () => {
    const config = defineRnDriverConfig({
      metro: {
        command: 'npx expo start --localhost --port 8081',
      },
      ios: {
        bundleId: 'com.company.app',
        workspace: 'ios/App.xcworkspace',
        appScheme: 'App',
        launch: {
          mode: 'attach',
          kind: 'expo-dev-client',
        },
        defaults: { EXDevMenuIsOnboardingFinished: true },
      },
      android: {
        packageName: 'com.company.app',
        activity: '.MainActivity',
        launch: { mode: 'launch', kind: 'plain' },
      },
      playwright: {
        config: 'playwright.config.ts',
      },
    })

    expect(config.ios?.launch.kind).toBe('expo-dev-client')
    expect(config.android?.launch.mode).toBe('launch')
  })
})
