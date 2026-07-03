import { defineRnDriverConfig } from '@unrulysystems/rn-playwright-driver-runner'

/**
 * Runner config for the example app's native e2e lifecycle. This is the
 * config-backed equivalent of `scripts/e2e-ios-xctest.sh` /
 * `scripts/e2e-android-instrumentation.sh`; run it with
 * `rn-driver test --platform <ios|android|all>`.
 *
 * The example is a plain Expo app (the companion launches it), so iOS uses
 * `launch` mode rather than dev-client `attach`.
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
    launch: { mode: 'launch', kind: 'plain' },
  },
  android: {
    packageName: 'com.unrulyfall.example',
    activity: '.MainActivity',
    launch: { mode: 'launch', kind: 'plain' },
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
