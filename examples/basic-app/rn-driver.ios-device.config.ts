import { networkInterfaces } from 'node:os'
import { defineRnDriverConfig } from '@unrulysystems/rn-playwright-driver-runner'

const bundleId = 'com.unrulyfall.example'
const metroPort = numberFromEnv('RN_DRIVER_IOS_DEVICE_METRO_PORT') ?? 8083
const metroHost = process.env.RN_DRIVER_IOS_DEVICE_METRO_HOST ?? firstLanIpv4()
const metroUrl = process.env.RN_DRIVER_IOS_DEVICE_METRO_URL ?? `http://${metroHost}:${metroPort}`

export default defineRnDriverConfig({
  timeoutMs: 420_000,
  metro: {
    url: metroUrl,
    command: `CI=1 EXPO_NO_TELEMETRY=1 nub exec expo start --dev-client --host lan --port ${metroPort}`,
    readyTimeoutMs: 120_000,
  },
  ios: {
    target: 'device',
    allowProvisioningUpdates: true,
    bundleId,
    scheme: 'exp+example',
    workspace: 'ios/example.xcworkspace',
    appScheme: 'example',
    launch: {
      mode: 'attach',
      kind: 'expo-dev-client',
      initialUrl: metroUrl,
    },
    companion: {
      readyTimeoutMs: 300_000,
    },
  },
  playwright: {
    config: 'playwright.config.ts',
    specs: ['e2e/integration/counter.spec.ts', 'e2e/visual/ios-device-visual.spec.ts'],
  },
  hooks: {
    configureTarget: (target) =>
      target.platform === 'ios' && target.kind === 'device'
        ? {
            steps: {
              beforeLaunch: [
                {
                  id: 'example.terminate-ios-app-before-seed',
                  description: 'Terminate stale iOS app before seeding Expo defaults',
                  command: {
                    command: 'node',
                    args: [
                      'scripts/terminate-ios-app.mjs',
                      '--udid',
                      target.id,
                      '--executable-name',
                      'example',
                    ],
                  },
                },
                {
                  id: 'example.seed-ios-dev-client',
                  description: 'Seed Expo dev-client local-network default',
                  command: {
                    command: 'node',
                    args: [
                      'scripts/seed-ios-dev-client-defaults.mjs',
                      '--bundle-id',
                      bundleId,
                      '--udid',
                      target.id,
                      '--metro-url',
                      metroUrl,
                    ],
                  },
                },
              ],
            },
          }
        : undefined,
  },
})

function numberFromEnv(name: string): number | undefined {
  const raw = process.env[name]
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function firstLanIpv4(): string {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address
    }
  }
  throw new Error(
    'RN_DRIVER_IOS_DEVICE_METRO_HOST is required because no non-internal IPv4 address was found',
  )
}
