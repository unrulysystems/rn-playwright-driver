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
    // CI=1 keeps Expo non-interactive when backgrounded; 8083 avoids the
    // machine's other Metro instances (8081/8082 are taken by other projects).
    command: 'CI=1 EXPO_NO_TELEMETRY=1 npx expo start --localhost --port 8083',
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
    ],
  },
})
