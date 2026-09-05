import type { IosConfig, PlaywrightConfig } from '../config'
import { COMPANION_FAILURE_MARKERS, DEFAULTS, E2E_MARKER_ENV } from '../constants'
import { buildIosDriverEnv } from './env'
import type { ResolvedIosTarget, ResolvedMetro } from './resolved'
import { cmd, metroStartStep, packageBin, playwrightCommand, projectPath } from './shared'
import type { CleanupAction, CommandSpec, Plan, SeedIosDefaultsSpec, Step } from './types'

export interface PlanIosInput {
  readonly ios: IosConfig
  readonly metro: ResolvedMetro
  readonly resolved: ResolvedIosTarget
  readonly playwright: PlaywrightConfig | undefined
  readonly timeoutMs: number | undefined
  /** Project/config directory for commands that run relative to the app workspace. */
  readonly projectCwd?: string
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
 * The companion reads its port + token reference from the runtime-config JSON
 * written into the UI-test target resource (the documented reliable path when
 * Xcode does not propagate test env vars). Simulators can read the host token
 * file directly; physical devices receive a generated UI-test resource copied
 * from the same `0600` file so token material stays out of argv/env/log output.
 */
export function planIos(input: PlanIosInput): Plan {
  const { ios, metro, resolved, playwright, timeoutMs, projectCwd, specs, passthrough } = input
  const isDevClient = ios.launch.kind === 'expo-dev-client'
  const runtimeConfigFile = projectPath(projectCwd, resolved.runtimeConfigFile)

  const steps: Step[] = []
  const push = (step: Step) => steps.push(step)

  if (resolved.kind === 'simulator') {
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
      action: {
        type: 'command',
        command: xcrun(['simctl', 'bootstatus', resolved.simUdid, '-b']),
      },
    })
  }

  // build — regenerate the project, scaffold the companion target, write the
  // per-run runtime config, install pods. The token/config refresh is NOT
  // skippable; the project-mutating steps are (REQ-CLI-004).
  push({
    id: 'ios.prebuild',
    stage: 'build',
    description: 'Generate iOS project (expo prebuild)',
    action: {
      type: 'command',
      // The marker lets marker-gated config plugins apply (REQ-SEAM-001).
      command: {
        ...packageBin('expo', ['prebuild', '--platform', 'ios', '--no-install'], projectCwd),
        env: E2E_MARKER_ENV,
      },
    },
    skippable: true,
  })
  push({
    id: 'ios.scaffold',
    stage: 'build',
    description: 'Scaffold XCTest companion target',
    action: {
      type: 'command',
      // Spawn the scaffold as `node <abs scaffoldBin>` — the resolver pins the
      // companion's bin to an absolute path that is hoist-safe (works when a
      // monorepo hoists it to the repo root) and exec-bit/shebang-independent.
      // Pass the resolved UI-test scheme so a custom `ios.uitestScheme` scaffolds
      // the SAME target that companion startup later builds (default is
      // `${appScheme}UITests`).
      command: cmd(
        'node',
        [
          resolved.scaffoldBin,
          '--ios-dir',
          'ios',
          '--project-name',
          ios.appScheme,
          '--uitest-scheme',
          resolved.uitestScheme,
        ],
        projectCwd,
      ),
    },
    skippable: true,
  })
  push({
    id: 'ios.runtime-config',
    stage: 'build',
    description: 'Write companion runtime config (port + token-file ref)',
    action: {
      type: 'write-file',
      path: runtimeConfigFile,
      contents: runtimeConfigJson(resolved, ios),
      mode: 0o600,
    },
  })
  if (resolved.kind === 'device') {
    push({
      id: 'ios.runtime-token',
      stage: 'build',
      description: 'Copy companion token into UI-test bundle resource',
      action: {
        type: 'copy-file',
        from: resolved.tokenFile,
        to: projectPath(projectCwd, resolved.runtimeTokenFile),
        mode: 0o600,
      },
    })
  }
  push({
    id: 'ios.pods',
    stage: 'build',
    description: 'Install CocoaPods',
    action: {
      type: 'command',
      command: cmd('pod', ['install', '--project-directory=ios'], projectCwd),
    },
    skippable: true,
  })

  // metro — start (or reuse) the packager and wait for it.
  push(metroStartStep(metro, projectCwd))
  push({
    id: 'metro.ready',
    stage: 'metro',
    description: `Wait for Metro at ${metro.url}`,
    action: {
      type: 'probe',
      probe: { kind: 'metro-status', metroUrl: metro.url, timeoutMs: metro.readyTimeoutMs },
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
      command: xcodebuild(
        [
          'build',
          '-workspace',
          ios.workspace,
          '-scheme',
          ios.appScheme,
          '-destination',
          resolved.destination,
          ...allowProvisioningUpdatesArgs(ios),
          `RCT_METRO_PORT=${metro.port}`,
        ],
        undefined,
        projectCwd,
      ),
    },
    skippable: true,
  })

  // install — XCTest installs the app under test only when the companion launches
  // it (`launch`/`activate`). In `attach` mode the host owns the launch, so the
  // runner installs the built product itself; a fresh simulator otherwise fails
  // `simctl launch` with "not installed" (REQ-IOS-015). Not skippable: under
  // --skip-build the products exist and the install is cheap.
  push({
    id: 'ios.install-app',
    stage: 'build',
    description: `Install the built ${ios.appScheme} app on ${resolved.kind === 'simulator' ? resolved.simName : resolved.deviceName}`,
    action: {
      type: 'install-ios-app',
      spec: {
        target:
          resolved.kind === 'simulator'
            ? { kind: 'simulator', udid: resolved.simUdid }
            : { kind: 'device', udid: resolved.coreDeviceIdentifier },
        workspace: ios.workspace,
        scheme: ios.appScheme,
        destination: resolved.destination,
        ...(projectCwd ? { cwd: projectCwd } : {}),
      },
    },
  })

  if (resolved.kind === 'simulator') {
    // device — seed the app's own NSUserDefaults domain. The install above created
    // the data container; `simctl spawn defaults write <bundleId>` would land in the
    // simulator-wide domain the sandboxed app never reads (REQ-IOS-005).
    const seed = (id: string, description: string, entries: SeedIosDefaultsSpec['entries']) =>
      push({
        id,
        stage: 'device',
        description,
        action: {
          type: 'seed-ios-defaults',
          spec: { udid: resolved.simUdid, bundleId: ios.bundleId, entries },
        },
      })
    seed('ios.packager-host', 'Point app at Metro (RCT_jsLocation, RCT_packager_scheme)', [
      { key: 'RCT_jsLocation', value: `${metro.host}:${metro.port}` },
      { key: 'RCT_packager_scheme', value: 'http' },
    ])
    if (isDevClient) {
      // expo-dev-menu opens its onboarding sheet over the app at launch until the
      // user finishes it; that sheet would take the suite's first taps (REQ-IOS-016).
      seed('ios.dev-menu', 'Mark the dev-menu onboarding finished', [
        { key: 'EXDevMenuIsOnboardingFinished', value: true },
        { key: 'EXDevMenuShowsAtLaunch', value: false },
      ])
    }
    const configured = Object.entries(ios.defaults ?? {}).map(([key, value]) => ({ key, value }))
    if (configured.length > 0) {
      // App-specific pre-launch seeds from config (REQ-IOS-010).
      seed('ios.defaults', `Seed ${configured.map((e) => e.key).join(', ')}`, configured)
    }
  }

  // companion — free a stale listener (FU-3), start the UI-test server, wait for
  // it within a bound that covers a cold xcodebuild test build (FU-2).
  push({
    id: 'ios.free-port',
    stage: 'companion',
    description: `Free stale listener on port ${resolved.touchPort}`,
    action: { type: 'free-port', port: resolved.touchPort },
  })
  if (resolved.kind === 'device') {
    push({
      id: 'ios.port-forward',
      stage: 'companion',
      description: `Forward host port ${resolved.touchPort} to physical iOS companion`,
      action: {
        type: 'command',
        background: true,
        processKey: 'ios-port-forward',
        command: cmd('pymobiledevice3', [
          'usbmux',
          'forward',
          '--serial',
          resolved.id,
          String(resolved.touchPort),
          String(resolved.touchPort),
        ]),
      },
    })
  }
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
          ...allowProvisioningUpdatesArgs(ios),
          `-only-testing:${resolved.uitestScheme}/${DEFAULTS.xctestServerTest}`,
          `RCT_METRO_PORT=${metro.port}`,
        ],
        {
          RN_TOUCH_XCTEST_PORT: String(resolved.touchPort),
          RN_TOUCH_XCTEST_CONFIG_FILE: runtimeConfigFile,
        },
        projectCwd,
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
      // Abort early if `xcodebuild test` reports a build/test failure (it lingers "alive" after, so
      // the 300s readiness budget would otherwise be burnt waiting for a companion that cannot bind).
      failureMarkers: COMPANION_FAILURE_MARKERS.ios,
    },
  })

  // app-launch — dev-client: terminate-first then cold-launch with the target-reachable
  // Metro URL (FU-1). plain: the companion's launch mode already launched the app.
  if (isDevClient) {
    if (resolved.kind === 'simulator') {
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
    } else {
      push({
        id: 'ios.launch',
        stage: 'app-launch',
        description: `Cold-launch dev client on physical device via ${resolved.initialUrl}`,
        action: {
          type: 'command',
          command: xcrun([
            'devicectl',
            'device',
            'process',
            'launch',
            '--device',
            resolved.coreDeviceIdentifier,
            '--terminate-existing',
            '--payload-url',
            physicalDevClientUrl(ios, resolved.initialUrl),
            ios.bundleId,
          ]),
        },
      })
    }
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
        ...(resolved.kind === 'simulator' ? { deviceNameMatch: resolved.deviceName } : {}),
        timeoutMs: resolved.hermesTimeoutMs,
      },
    },
  })

  const cleanup: CleanupAction[] = [
    ...(resolved.kind === 'device'
      ? [
          {
            type: 'kill-process' as const,
            processKey: 'ios-port-forward',
            description: 'Stop iOS port forward',
          },
        ]
      : []),
    { type: 'kill-process', processKey: 'companion', description: 'Stop XCTest companion' },
    {
      type: 'free-port',
      port: resolved.touchPort,
      description: 'Free companion port (reap sim-hosted child)',
    },
    { type: 'kill-process', processKey: 'metro', description: 'Stop runner-owned Metro' },
    { type: 'remove-file', path: resolved.tokenFile, description: 'Remove per-run token file' },
    // REQ-SEC-004: the per-run runtime config (port + token-file ref) is written
    // into the UI-test target every run; remove it so no generated artifact is
    // left in the app project.
    {
      type: 'remove-file',
      path: runtimeConfigFile,
      description: 'Remove per-run companion runtime config',
    },
  ]
  if (resolved.kind === 'device') {
    cleanup.push({
      type: 'remove-file',
      path: projectPath(projectCwd, resolved.runtimeTokenFile),
      description: 'Remove per-run companion token resource',
    })
  }

  return {
    platform: 'ios',
    steps,
    cleanup,
    driverEnv: buildIosDriverEnv(resolved, metro, timeoutMs, ios.bundleId),
    playwright: playwrightCommand(playwright, specs, passthrough, projectCwd),
  }
}

function runtimeConfigJson(resolved: ResolvedIosTarget, ios: IosConfig): string {
  return JSON.stringify({
    port: resolved.touchPort,
    ...(resolved.kind === 'device'
      ? { authTokenResource: DEFAULTS.xctestTokenResourceName }
      : { authTokenFile: resolved.tokenFile }),
    launch: ios.launch.mode,
  })
}

function allowProvisioningUpdatesArgs(ios: IosConfig): string[] {
  return ios.allowProvisioningUpdates ? ['-allowProvisioningUpdates'] : []
}

function physicalDevClientUrl(ios: IosConfig, initialUrl: string): string {
  if (!ios.scheme) throw new Error('ios.scheme is required for physical iOS dev-client launch')
  return `${ios.scheme}://expo-development-client/?url=${encodeURIComponent(initialUrl)}`
}

// --- iOS-specific command constructors (no secret values ever flow through these) ---

function xcrun(args: string[]): CommandSpec {
  return { command: 'xcrun', args }
}

/** `env -u LD xcodebuild …` with optional extra env. */
function xcodebuild(args: string[], env?: Record<string, string>, cwd?: string): CommandSpec {
  return env
    ? { command: 'env', args: ['-u', 'LD', 'xcodebuild', ...args], env, ...(cwd ? { cwd } : {}) }
    : { command: 'env', args: ['-u', 'LD', 'xcodebuild', ...args], ...(cwd ? { cwd } : {}) }
}
