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
      hooks: {
        configureTarget: (target) => ({
          env: {
            metro: {
              EXPO_PUBLIC_E2E_TARGET: `${target.platform}:${target.kind}`,
            },
            playwright: {
              E2E_TARGET_ID: target.id,
            },
          },
          steps: {
            beforeLaunch:
              target.platform === 'android' && target.kind === 'emulator'
                ? [
                    {
                      id: 'app.reverse-supabase',
                      description: 'Reverse app-owned Supabase port',
                      stage: 'device',
                      command: {
                        command: 'adb',
                        args: ['-s', target.id, 'reverse', 'tcp:54321', 'tcp:54321'],
                      },
                    },
                  ]
                : [],
          },
          cleanup:
            target.platform === 'android' && target.kind === 'emulator'
              ? [
                  {
                    description: 'Remove app-owned Supabase reverse',
                    command: {
                      command: 'adb',
                      args: ['-s', target.id, 'reverse', '--remove', 'tcp:54321'],
                    },
                  },
                ]
              : [],
        }),
      },
    })

    expect(config.ios?.launch.kind).toBe('expo-dev-client')
    expect(config.android?.launch.mode).toBe('launch')
    expect(config.hooks?.configureTarget).toBeTypeOf('function')
  })
})
