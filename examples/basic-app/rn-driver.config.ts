import { defineRnDriverConfig } from '@unrulysystems/rn-playwright-driver-runner'

/**
 * Runner config for the example app's native e2e lifecycle. This is the
 * config-backed equivalent of `scripts/e2e-ios-xctest.sh` /
 * `scripts/e2e-android-instrumentation.sh`; run it with
 * `rn-driver test --platform <ios|android|all>`.
 *
 * The example is an Expo dev-client build (`expo-dev-client` is installed), so
 * the runner owns the launch on both platforms: iOS cold-launches with
 * `simctl launch --initialUrl` (companion in `attach` mode) and Android opens
 * the `exp+example://expo-development-client/?url=` deep link. A dev-client
 * build launched `plain` lands on the dev-launcher home screen on a fresh
 * simulator/emulator and never registers a Hermes target.
 */
export default defineRnDriverConfig({
  metro: {
    // 8083 avoids the machine's other Metro instances (8081/8082 are taken by
    // other projects). The runner's default Expo command keeps Metro
    // non-interactive and resolves the installed binary hoist-safely.
    // Expo SDK 56's `--localhost` listener is reachable on `localhost`/::1, not
    // necessarily 127.0.0.1, so keep the runner probe URL aligned with Expo.
    host: 'localhost',
    port: 8083,
  },
  ios: {
    bundleId: 'com.unrulyfall.example',
    workspace: 'ios/example.xcworkspace',
    appScheme: 'example',
    launch: { mode: 'attach', kind: 'expo-dev-client' },
    // expo-dev-menu shows a first-launch onboarding sheet over the app on a fresh
    // simulator; it would swallow the suite's first taps.
    defaults: { EXDevMenuIsOnboardingFinished: true },
  },
  android: {
    packageName: 'com.unrulyfall.example',
    activity: '.MainActivity',
    scheme: 'exp+example',
    launch: { mode: 'launch', kind: 'expo-dev-client' },
  },
  playwright: {
    config: 'playwright.config.ts',
    specs: [
      'e2e/integration/counter.spec.ts',
      'e2e/pointer',
      'e2e/scroll/scroll.spec.ts',
      'e2e/primitives/touch-backend.spec.ts',
      'e2e/files/device-files.spec.ts',
    ],
  },
  hooks: {
    configureTarget: (target) => ({
      env: {
        // Example of app-owned, target-aware configuration. Real apps can use
        // this hook to choose Supabase/RPC/localnet/tunnel URLs reachable from
        // the selected simulator/emulator without making the runner infer them.
        metro: {
          EXPO_PUBLIC_RN_DRIVER_E2E_TARGET: `${target.platform}:${target.kind}`,
        },
        playwright: {
          E2E_TARGET_ID: target.id,
          E2E_TARGET_KIND: target.kind,
        },
      },
    }),
  },
})
