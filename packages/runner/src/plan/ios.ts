import type { IosConfig, PlaywrightConfig } from '../config'
import { DEFAULTS } from '../constants'
import { buildIosDriverEnv } from './env'
import type { ResolvedIosTarget, ResolvedMetro } from './resolved'
import { cmd, metroStartStep, npx, playwrightCommand } from './shared'
import type { CleanupAction, CommandSpec, Plan, Step } from './types'

export interface PlanIosInput {
  readonly ios: IosConfig
  readonly metro: ResolvedMetro
  readonly resolved: ResolvedIosTarget
  readonly playwright: PlaywrightConfig | undefined
  readonly timeoutMs: number | undefined
  /** Positional spec paths; override the config spec list when non-empty. */
  readonly specs: readonly string[]
  /** Args after `--`; always appended to the Playwright invocation. */
  readonly passthrough: readonly string[]
}

/**
 * Pure planner for the iOS XCTest lifecycle. Given config + already-resolved
 * runtime values, returns the ordered, side-effect-free {@link Plan}. Identical
 * inputs always yield an identical plan.
 *
 * The companion reads its port + token-file path from the runtime-config JSON
 * written into the UI-test target resource (the documented reliable path when
 * Xcode does not propagate test env vars). The token *value* lives only in the
 * separate `0600` file referenced by `authTokenFile`; it never enters the plan.
 */
export function planIos(input: PlanIosInput): Plan {
  const { ios, metro, resolved, playwright, timeoutMs, specs, passthrough } = input
  const isDevClient = ios.launch.kind === 'expo-dev-client'

  const steps: Step[] = []
  const push = (step: Step) => steps.push(step)

  // device — boot (and wait for) the target simulator. `pickSimulator` can pick a
  // shutdown sim (newest available when none booted), so issue `simctl boot`
  // first (REQ-IOS-001); it exits non-zero when already booted ("current state:
  // Booted"), which is the benign precondition we want, so allowFailure. Then
  // `bootstatus -b` blocks until the sim is fully booted.
  push({
    id: 'ios.boot',
    stage: 'device',
    description: `Boot simulator ${resolved.simName}`,
    action: {
      type: 'command',
      command: xcrun(['simctl', 'boot', resolved.simUdid]),
      allowFailure: true,
    },
  })
  push({
    id: 'ios.boot-wait',
    stage: 'device',
    description: `Wait for ${resolved.simName} to finish booting`,
    action: { type: 'command', command: xcrun(['simctl', 'bootstatus', resolved.simUdid, '-b']) },
  })

  // build — regenerate the project, scaffold the companion target, write the
  // per-run runtime config, install pods. The token/config refresh is NOT
  // skippable; the project-mutating steps are (REQ-CLI-004).
  push({
    id: 'ios.prebuild',
    stage: 'build',
    description: 'Generate iOS project (expo prebuild)',
    action: {
      type: 'command',
      command: npx(['expo', 'prebuild', '--platform', 'ios', '--no-install']),
    },
    skippable: true,
  })
  push({
    id: 'ios.scaffold',
    stage: 'build',
    description: 'Scaffold XCTest companion target',
    action: {
      type: 'command',
      command: npx([
        'rn-driver-xctest-scaffold',
        '--ios-dir',
        'ios',
        '--project-name',
        ios.appScheme,
      ]),
    },
    skippable: true,
  })
  push({
    id: 'ios.runtime-config',
    stage: 'build',
    description: 'Write companion runtime config (port + token-file ref)',
    action: {
      type: 'write-file',
      path: resolved.runtimeConfigFile,
      contents: runtimeConfigJson(resolved, ios),
      mode: 0o600,
    },
  })
  push({
    id: 'ios.pods',
    stage: 'build',
    description: 'Install CocoaPods',
    action: { type: 'command', command: cmd('pod', ['install', '--project-directory=ios']) },
    skippable: true,
  })

  // metro — start (or reuse) the packager and wait for it.
  push(metroStartStep(metro))
  push({
    id: 'metro.ready',
    stage: 'metro',
    description: `Wait for Metro at ${metro.url}`,
    action: {
      type: 'probe',
      probe: { kind: 'metro-status', metroUrl: metro.url, timeoutMs: metro.readyTimeoutMs },
    },
  })

  // device — point the app at this Metro via NSUserDefaults (best-effort).
  push({
    id: 'ios.packager-host-location',
    stage: 'device',
    description: 'Point app at Metro (RCT_jsLocation)',
    action: {
      type: 'command',
      command: xcrun([
        'simctl',
        'spawn',
        resolved.simUdid,
        'defaults',
        'write',
        ios.bundleId,
        'RCT_jsLocation',
        `${metro.host}:${metro.port}`,
      ]),
      allowFailure: true,
    },
  })
  push({
    id: 'ios.packager-host-scheme',
    stage: 'device',
    description: 'Point app at Metro (RCT_packager_scheme)',
    action: {
      type: 'command',
      command: xcrun([
        'simctl',
        'spawn',
        resolved.simUdid,
        'defaults',
        'write',
        ios.bundleId,
        'RCT_packager_scheme',
        'http',
      ]),
      allowFailure: true,
    },
  })

  // build — compile the app scheme. `env -u LD` avoids the generic-Unix LD=ld
  // link failure (REQ-IOS-004).
  push({
    id: 'ios.build-app',
    stage: 'build',
    description: `Build app scheme ${ios.appScheme}`,
    action: {
      type: 'command',
      command: xcodebuild([
        'build',
        '-workspace',
        ios.workspace,
        '-scheme',
        ios.appScheme,
        '-destination',
        resolved.destination,
        `RCT_METRO_PORT=${metro.port}`,
      ]),
    },
    skippable: true,
  })

  // device — app-specific pre-launch seeds (e.g. onboarding flags).
  for (const [key, value] of Object.entries(ios.defaults ?? {})) {
    push({
      id: `ios.seed.${key}`,
      stage: 'device',
      description: `Seed default ${key}`,
      action: {
        type: 'command',
        command: xcrun([
          'simctl',
          'spawn',
          resolved.simUdid,
          'defaults',
          'write',
          ios.bundleId,
          ...defaultsArgs(key, value),
        ]),
        allowFailure: true,
      },
    })
  }

  // companion — free a stale listener (FU-3), start the UI-test server, wait for
  // it within a bound that covers a cold xcodebuild test build (FU-2).
  push({
    id: 'ios.free-port',
    stage: 'companion',
    description: `Free stale listener on port ${resolved.touchPort}`,
    action: { type: 'free-port', port: resolved.touchPort },
  })
  push({
    id: 'ios.companion-start',
    stage: 'companion',
    description: `Start XCTest companion on port ${resolved.touchPort}`,
    action: {
      type: 'command',
      background: true,
      processKey: 'companion',
      command: xcodebuild(
        [
          'test',
          '-workspace',
          ios.workspace,
          '-scheme',
          resolved.uitestScheme,
          '-destination',
          resolved.destination,
          `-only-testing:${resolved.uitestScheme}/${DEFAULTS.xctestServerTest}`,
          `RCT_METRO_PORT=${metro.port}`,
        ],
        {
          RN_TOUCH_XCTEST_PORT: String(resolved.touchPort),
          RN_TOUCH_XCTEST_CONFIG_FILE: resolved.runtimeConfigFile,
        },
      ),
    },
  })
  push({
    id: 'ios.companion-ready',
    stage: 'companion',
    description: 'Wait for companion to accept a hello',
    action: {
      type: 'probe',
      probe: {
        kind: 'xctest-hello',
        port: resolved.touchPort,
        tokenFile: resolved.tokenFile,
        timeoutMs: resolved.companionReadyTimeoutMs,
      },
    },
  })

  // app-launch — dev-client: terminate-first then cold-launch via --initialUrl
  // (FU-1). plain: the companion's launch mode already launched the app.
  if (isDevClient) {
    push({
      id: 'ios.terminate-before-launch',
      stage: 'app-launch',
      description: 'Terminate any running instance (cold launch requires it)',
      action: {
        type: 'command',
        command: xcrun(['simctl', 'terminate', resolved.simUdid, ios.bundleId]),
        allowFailure: true,
      },
    })
    push({
      id: 'ios.launch',
      stage: 'app-launch',
      description: `Cold-launch dev client via --initialUrl ${resolved.initialUrl}`,
      action: {
        type: 'command',
        command: xcrun([
          'simctl',
          'launch',
          resolved.simUdid,
          ios.bundleId,
          '--initialUrl',
          resolved.initialUrl,
        ]),
      },
    })
  }

  // hermes-target — wait for a Hermes target on THIS simulator before testing.
  push({
    id: 'ios.hermes',
    stage: 'hermes-target',
    description: 'Wait for Hermes target',
    action: {
      type: 'probe',
      probe: {
        kind: 'hermes-target',
        platform: 'ios',
        metroUrl: metro.url,
        appId: ios.bundleId,
        deviceNameMatch: resolved.simName,
        timeoutMs: resolved.hermesTimeoutMs,
      },
    },
  })

  const cleanup: CleanupAction[] = [
    { type: 'kill-process', processKey: 'companion', description: 'Stop XCTest companion' },
    {
      type: 'free-port',
      port: resolved.touchPort,
      description: 'Free companion port (reap sim-hosted child)',
    },
    { type: 'kill-process', processKey: 'metro', description: 'Stop runner-owned Metro' },
    { type: 'remove-file', path: resolved.tokenFile, description: 'Remove per-run token file' },
  ]

  return {
    platform: 'ios',
    steps,
    cleanup,
    driverEnv: buildIosDriverEnv(resolved, metro, timeoutMs),
    playwright: playwrightCommand(playwright, specs, passthrough),
  }
}

function runtimeConfigJson(resolved: ResolvedIosTarget, ios: IosConfig): string {
  return JSON.stringify({
    port: resolved.touchPort,
    authTokenFile: resolved.tokenFile,
    launch: ios.launch.mode,
  })
}

function defaultsArgs(key: string, value: string | number | boolean): string[] {
  if (typeof value === 'boolean') return [key, '-bool', value ? 'YES' : 'NO']
  if (typeof value === 'number') return [key, '-int', String(value)]
  return [key, value]
}

// --- iOS-specific command constructors (no secret values ever flow through these) ---

function xcrun(args: string[]): CommandSpec {
  return { command: 'xcrun', args }
}

/** `env -u LD xcodebuild …` with optional extra env. */
function xcodebuild(args: string[], env?: Record<string, string>): CommandSpec {
  return env
    ? { command: 'env', args: ['-u', 'LD', 'xcodebuild', ...args], env }
    : { command: 'env', args: ['-u', 'LD', 'xcodebuild', ...args] }
}
