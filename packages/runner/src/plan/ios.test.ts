import { describe, expect, it } from 'vitest'
import { iosConfigFixture, iosDevClientConfigFixture } from '../fixtures'
import { planIos, type PlanIosInput } from './ios'
import { placeholderIos, resolveMetro } from './resolved'
import type { CommandSpec, Plan } from './types'

function inputFor(
  kind: 'plain' | 'expo-dev-client',
  overrides: Partial<PlanIosInput> = {},
): PlanIosInput {
  const ios = kind === 'plain' ? iosConfigFixture() : iosDevClientConfigFixture()
  const metro = resolveMetro({ command: 'npx expo start' })
  return {
    ios,
    metro,
    resolved: placeholderIos(ios, metro),
    playwright: { config: 'playwright.config.ts' },
    timeoutMs: undefined,
    specs: [],
    passthrough: [],
    ...overrides,
  }
}

const stepIds = (plan: Plan): string[] => plan.steps.map((s) => s.id)

/** Every argv/env/cwd/stdin string across the whole plan. */
function allCommandStrings(plan: Plan): string[] {
  const out: string[] = []
  const eat = (c: CommandSpec) => {
    out.push(c.command, ...c.args)
    if (c.cwd) out.push(c.cwd)
    if (c.stdinFromFile) out.push(c.stdinFromFile)
    if (c.stdinContents) out.push(c.stdinContents)
    if (c.env) out.push(...Object.entries(c.env).flat())
  }
  for (const step of plan.steps) {
    if (step.action.type === 'command') eat(step.action.command)
  }
  for (const action of plan.cleanup) {
    if (action.type === 'command') eat(action.command)
  }
  eat(plan.playwright)
  out.push(...Object.entries(plan.driverEnv).flat())
  return out
}

describe('planIos', () => {
  it('produces the iOS lifecycle stages in order for a plain app', () => {
    const ids = stepIds(planIos(inputFor('plain')))
    expect(ids).toEqual([
      'ios.boot',
      'ios.boot-wait',
      'ios.prebuild',
      'ios.scaffold',
      'ios.runtime-config',
      'ios.pods',
      'metro.start',
      'metro.ready',
      'ios.packager-host-location',
      'ios.packager-host-scheme',
      'ios.build-app',
      'ios.free-port',
      'ios.companion-start',
      'ios.companion-ready',
      'ios.hermes',
    ])
  })

  it('plain apps do NOT host-launch (the companion launch mode owns it)', () => {
    const ids = stepIds(planIos(inputFor('plain')))
    expect(ids).not.toContain('ios.terminate-before-launch')
    expect(ids).not.toContain('ios.launch')
  })

  it('FU-1: dev-client terminates first, then cold-launches via --initialUrl', () => {
    const plan = planIos(inputFor('expo-dev-client'))
    const ids = stepIds(plan)
    const terminateAt = ids.indexOf('ios.terminate-before-launch')
    const launchAt = ids.indexOf('ios.launch')
    expect(terminateAt).toBeGreaterThanOrEqual(0)
    expect(launchAt).toBe(terminateAt + 1)

    const launch = plan.steps[launchAt]?.action
    const args = launch?.type === 'command' ? launch.command.args : []
    expect(args).toContain('launch') // simctl launch, NOT openurl
    expect(args).not.toContain('openurl')
    expect(args).toContain('--initialUrl')
  })

  it('plans physical iOS dev-client launch through devicectl without simulator-only steps', () => {
    const ios = iosDevClientConfigFixture({
      target: 'device',
      launch: {
        mode: 'attach',
        kind: 'expo-dev-client',
        initialUrl: 'http://192.168.1.10:8081',
      },
    })
    const metro = resolveMetro({ url: 'http://127.0.0.1:8081' })
    const resolved = placeholderIos(ios, metro)
    if (resolved.kind !== 'device') throw new Error('expected physical iOS placeholder')
    const plan = planIos(
      inputFor('expo-dev-client', {
        ios,
        metro,
        resolved: {
          ...resolved,
          id: '00008130-0012493614E8001C',
          deviceName: 'Roman Crystal',
          coreDeviceIdentifier: '5F926583-22CF-51A7-A3D8-4C9C660C31CA',
        },
      }),
    )

    const ids = stepIds(plan)
    expect(ids).not.toContain('ios.boot')
    expect(ids).not.toContain('ios.boot-wait')
    expect(ids).not.toContain('ios.packager-host-location')
    expect(ids).not.toContain('ios.packager-host-scheme')
    expect(ids).not.toContain('ios.terminate-before-launch')
    expect(ids).toContain('ios.runtime-token')
    expect(ids).toContain('ios.port-forward')
    expect(ids).toContain('ios.launch')

    const launch = plan.steps.find((s) => s.id === 'ios.launch')?.action
    expect(launch?.type).toBe('command')
    if (launch?.type !== 'command') throw new Error('expected command')
    expect(launch.command).toMatchObject({
      command: 'xcrun',
      args: [
        'devicectl',
        'device',
        'process',
        'launch',
        '--device',
        '5F926583-22CF-51A7-A3D8-4C9C660C31CA',
        '--terminate-existing',
        '--payload-url',
        'exp+example://expo-development-client/?url=http%3A%2F%2F192.168.1.10%3A8081',
        'com.unrulyfall.example',
      ],
    })
    expect(plan.driverEnv).toMatchObject({
      RN_SIM_UDID: '00008130-0012493614E8001C',
      RN_IOS_TARGET_KIND: 'device',
    })
    expect(plan.driverEnv).not.toHaveProperty('RN_DEVICE_NAME')
    const hermes = plan.steps.find((s) => s.id === 'ios.hermes')?.action
    expect(hermes?.type).toBe('probe')
    if (hermes?.type !== 'probe' || hermes.probe.kind !== 'hermes-target') {
      throw new Error('expected Hermes probe')
    }
    expect(hermes.probe).not.toHaveProperty('deviceNameMatch')
    const forward = plan.steps.find((s) => s.id === 'ios.port-forward')?.action
    expect(forward?.type).toBe('command')
    if (forward?.type !== 'command') throw new Error('expected command')
    expect(forward).toMatchObject({
      background: true,
      processKey: 'ios-port-forward',
      command: {
        command: 'pymobiledevice3',
        args: ['usbmux', 'forward', '--serial', '00008130-0012493614E8001C', '9999', '9999'],
      },
    })
    expect(plan.cleanup).toContainEqual(
      expect.objectContaining({
        type: 'kill-process',
        processKey: 'ios-port-forward',
      }),
    )
    expect(plan.cleanup).toContainEqual(
      expect.objectContaining({
        type: 'remove-file',
        path: '<runtime-token>',
      }),
    )
  })

  it('FU-2: companion readiness defaults to 300s and is configurable', () => {
    const plan = planIos(inputFor('plain'))
    const ready = plan.steps.find((s) => s.id === 'ios.companion-ready')?.action
    expect(ready?.type === 'probe' && ready.probe.timeoutMs).toBe(300_000)

    const custom = planIos(
      inputFor('plain', {
        resolved: {
          ...placeholderIos(iosConfigFixture(), resolveMetro({})),
          companionReadyTimeoutMs: 120_000,
        },
      }),
    )
    const customReady = custom.steps.find((s) => s.id === 'ios.companion-ready')?.action
    expect(customReady?.type === 'probe' && customReady.probe.timeoutMs).toBe(120_000)
  })

  it('FU-2b: companion-ready watches for xcodebuild build/test failure markers (fast-fail)', () => {
    const ready = planIos(inputFor('plain')).steps.find(
      (s) => s.id === 'ios.companion-ready',
    )?.action
    expect(ready?.type).toBe('probe')
    const markers = ready?.type === 'probe' ? ready.failureMarkers : undefined
    // The probe must abort the readiness wait the moment `xcodebuild test` reports failure rather
    // than burning the 300s budget (it lingers "alive" after printing the marker).
    expect(markers).toEqual(expect.arrayContaining(['** BUILD FAILED **', '** TEST FAILED **']))
  })

  it('FU-3: frees the companion port at startup and in cleanup', () => {
    const plan = planIos(inputFor('plain'))
    const startupFree = plan.steps.find((s) => s.id === 'ios.free-port')
    expect(startupFree?.action.type).toBe('free-port')
    expect(plan.cleanup).toContainEqual(expect.objectContaining({ type: 'free-port', port: 9999 }))
  })

  it('REQ-IOS-004: xcodebuild runs under `env -u LD`', () => {
    const plan = planIos(inputFor('plain'))
    const build = plan.steps.find((s) => s.id === 'ios.build-app')?.action
    expect(build?.type === 'command' && build.command.command).toBe('env')
    expect(build?.type === 'command' && build.command.args.slice(0, 3)).toEqual([
      '-u',
      'LD',
      'xcodebuild',
    ])
  })

  it('passes -allowProvisioningUpdates to xcodebuild only when explicitly enabled', () => {
    const defaultPlan = planIos(inputFor('plain'))
    const defaultBuild = defaultPlan.steps.find((s) => s.id === 'ios.build-app')?.action
    const defaultCompanion = defaultPlan.steps.find((s) => s.id === 'ios.companion-start')?.action
    expect(defaultBuild?.type === 'command' && defaultBuild.command.args).not.toContain(
      '-allowProvisioningUpdates',
    )
    expect(defaultCompanion?.type === 'command' && defaultCompanion.command.args).not.toContain(
      '-allowProvisioningUpdates',
    )

    const ios = iosDevClientConfigFixture({
      target: 'device',
      allowProvisioningUpdates: true,
      launch: {
        mode: 'attach',
        kind: 'expo-dev-client',
        initialUrl: 'http://192.168.1.10:8081',
      },
    })
    const metro = resolveMetro({ url: 'http://127.0.0.1:8081' })
    const resolved = placeholderIos(ios, metro)
    if (resolved.kind !== 'device') throw new Error('expected physical iOS placeholder')
    const plan = planIos(inputFor('expo-dev-client', { ios, metro, resolved }))
    const build = plan.steps.find((s) => s.id === 'ios.build-app')?.action
    const companion = plan.steps.find((s) => s.id === 'ios.companion-start')?.action
    expect(build?.type === 'command' && build.command.args).toContain('-allowProvisioningUpdates')
    expect(companion?.type === 'command' && companion.command.args).toContain(
      '-allowProvisioningUpdates',
    )
  })

  it('marks project-mutating build steps skippable, but not the token/config refresh', () => {
    const plan = planIos(inputFor('plain'))
    const skippable = plan.steps.filter((s) => s.skippable).map((s) => s.id)
    expect(skippable).toEqual(['ios.prebuild', 'ios.scaffold', 'ios.pods', 'ios.build-app'])
    expect(plan.steps.find((s) => s.id === 'ios.runtime-config')?.skippable).toBeFalsy()
  })

  it('spawns the XCTest scaffold as `node <abs scaffoldBin>` (hoist-safe, no cwd-relative bin)', () => {
    // The resolver hands planIos an ABSOLUTE scaffold path (createRequire-resolved,
    // so it works when a monorepo hoists the companion bin to the repo root). The
    // plan must spawn it via `node <abs>` rather than the old cwd-relative
    // `node_modules/.bin/...` literal that ENOENTs in a hoisted workspace.
    const scaffoldBin =
      '/abs/node_modules/@unrulysystems/rn-playwright-driver-xctest-companion/bin/scaffold.js'
    const ios = iosConfigFixture()
    const metro = resolveMetro({ command: 'npx expo start' })
    const plan = planIos(
      inputFor('plain', { resolved: { ...placeholderIos(ios, metro), scaffoldBin } }),
    )
    const scaffold = plan.steps.find((s) => s.id === 'ios.scaffold')?.action
    expect(scaffold?.type).toBe('command')
    if (scaffold?.type !== 'command') throw new Error('expected command')
    expect(scaffold.command.command).toBe('node')
    expect(scaffold.command.args[0]).toBe(scaffoldBin)
    expect(scaffold.command.args[0]).toMatch(/\/bin\/scaffold\.js$/)
    // Never the cwd-relative literal that breaks in a hoisted monorepo.
    expect(scaffold.command.command).not.toBe('node_modules/.bin/rn-driver-xctest-scaffold')
    // The scaffold args (ios dir, project name, resolved uitest scheme) are preserved.
    expect(scaffold.command.args.slice(1)).toEqual([
      '--ios-dir',
      'ios',
      '--project-name',
      ios.appScheme,
      '--uitest-scheme',
      placeholderIos(ios, metro).uitestScheme,
    ])
  })

  it('emits the driver env contract with a token FILE, never an inline token', () => {
    const plan = planIos(inputFor('plain'))
    expect(plan.driverEnv).toMatchObject({
      RN_TOUCH_BACKEND: 'xctest',
      RN_TOUCH_XCTEST_TOKEN_FILE: '<token-file>',
      // device.files targeting (REQ-TGT-*): iOS needs bundle id, sim udid, kind.
      RN_APP_BUNDLE_ID: 'com.unrulyfall.example',
      RN_SIM_UDID: '<sim-udid>',
      RN_IOS_TARGET_KIND: 'simulator',
    })
    expect(plan.driverEnv).not.toHaveProperty('RN_TOUCH_XCTEST_TOKEN')
  })

  it('secret-safety: no inline *_TOKEN env key appears anywhere in the plan', () => {
    const plan = planIos(inputFor('expo-dev-client'))
    const envKeys = plan.steps.flatMap((s) =>
      s.action.type === 'command' && s.action.command.env ? Object.keys(s.action.command.env) : [],
    )
    envKeys.push(...Object.keys(plan.driverEnv))
    for (const key of envKeys) {
      expect(key.endsWith('_TOKEN')).toBe(false)
    }
  })

  it('secret-safety: the runtime config carries the token-file path, not a value', () => {
    const resolved = {
      ...placeholderIos(iosConfigFixture(), resolveMetro({})),
      tokenFile: '/run/rn-XXXX.token',
    }
    const plan = planIos(inputFor('plain', { resolved }))
    const write = plan.steps.find((s) => s.id === 'ios.runtime-config')?.action
    const contents = write?.type === 'write-file' ? JSON.parse(write.contents) : {}
    expect(contents.authTokenFile).toBe('/run/rn-XXXX.token')
    expect(contents).not.toHaveProperty('authToken')
    // Token material only ever appears as a file path, never alongside a value key.
    expect(allCommandStrings(plan)).not.toContain('authToken')
  })

  it('secret-safety: physical iOS bundles a token resource reference, not an inline token', () => {
    const ios = iosDevClientConfigFixture({
      target: 'device',
      launch: {
        mode: 'attach',
        kind: 'expo-dev-client',
        initialUrl: 'http://192.168.1.10:8081',
      },
    })
    const metro = resolveMetro({ url: 'http://127.0.0.1:8081' })
    const resolved = {
      ...placeholderIos(ios, metro),
      tokenFile: '/run/rn-XXXX.token',
      runtimeTokenFile: 'ios/exampleUITests/RNDriverTouchCompanionToken',
    }
    if (resolved.kind !== 'device') throw new Error('expected physical iOS placeholder')
    const plan = planIos(inputFor('expo-dev-client', { ios, metro, resolved }))

    const configWrite = plan.steps.find((s) => s.id === 'ios.runtime-config')?.action
    const contents = configWrite?.type === 'write-file' ? JSON.parse(configWrite.contents) : {}
    expect(contents.authTokenResource).toBe('RNDriverTouchCompanionToken')
    expect(contents).not.toHaveProperty('authToken')
    expect(contents).not.toHaveProperty('authTokenFile')

    const tokenCopy = plan.steps.find((s) => s.id === 'ios.runtime-token')?.action
    expect(tokenCopy).toMatchObject({
      type: 'copy-file',
      from: '/run/rn-XXXX.token',
      to: 'ios/exampleUITests/RNDriverTouchCompanionToken',
      mode: 0o600,
    })
  })

  it('resolves project-relative runtime config and project commands from projectCwd', () => {
    const ios = iosConfigFixture()
    const metro = resolveMetro({})
    const plan = planIos(
      inputFor('plain', {
        projectCwd: '/app',
        resolved: {
          ...placeholderIos(ios, metro),
          runtimeConfigFile: 'ios/exampleUITests/RNDriverTouchCompanionRuntimeConfig.json',
        },
      }),
    )
    const runtimeConfig = plan.steps.find((s) => s.id === 'ios.runtime-config')?.action
    const companion = plan.steps.find((s) => s.id === 'ios.companion-start')?.action

    expect(runtimeConfig?.type === 'write-file' && runtimeConfig.path).toBe(
      '/app/ios/exampleUITests/RNDriverTouchCompanionRuntimeConfig.json',
    )
    expect(companion?.type === 'command' && companion.command.env).toMatchObject({
      RN_TOUCH_XCTEST_CONFIG_FILE:
        '/app/ios/exampleUITests/RNDriverTouchCompanionRuntimeConfig.json',
    })
  })

  it('is pure: identical input yields a deep-equal plan', () => {
    expect(planIos(inputFor('expo-dev-client'))).toEqual(planIos(inputFor('expo-dev-client')))
  })
})
