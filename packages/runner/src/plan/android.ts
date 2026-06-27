import type { AndroidConfig, PlaywrightConfig } from '../config'
import { DEFAULTS } from '../constants'
import { buildAndroidDriverEnv } from './env'
import type { ResolvedAndroidTarget, ResolvedMetro } from './resolved'
import { metroStartStep, npx, playwrightCommand } from './shared'
import type { CleanupAction, CommandSpec, Plan, Step } from './types'

export interface PlanAndroidInput {
  readonly android: AndroidConfig
  readonly metro: ResolvedMetro
  readonly resolved: ResolvedAndroidTarget
  readonly playwright: PlaywrightConfig | undefined
  readonly timeoutMs: number | undefined
  readonly playwrightArgs: readonly string[]
  /**
   * The Hermes target device name to pin (`RN_DEVICE_NAME`). Resolved at run
   * time on a real run; a placeholder for `--dry-run`.
   */
  readonly hermesDeviceName: string
}

/**
 * Pure planner for the Android instrumentation lifecycle. The companion auth
 * token is installed into the app's private `files/` directory and referenced by
 * the `rnDriverAuthTokenFile` instrument argument — never the inline token
 * argument (REQ-AND-006). The host token file is piped to the device via stdin,
 * so the value never enters argv.
 */
export function planAndroid(input: PlanAndroidInput): Plan {
  const { android, metro, resolved, playwright, timeoutMs, playwrightArgs, hermesDeviceName } =
    input
  const serial = resolved.serial
  const gradleTasks = android.gradleTasks ?? [...DEFAULTS.androidGradleTasks]
  const appApk = android.appApkPath ?? DEFAULTS.androidAppApkPath
  const testApk = android.testApkPath ?? DEFAULTS.androidTestApkPath

  const steps: Step[] = []
  const push = (step: Step) => steps.push(step)

  // build — regenerate project, build APKs, install both.
  push({
    id: 'android.prebuild',
    stage: 'build',
    description: 'Generate Android project (expo prebuild)',
    action: {
      type: 'command',
      command: npx(['expo', 'prebuild', '--platform', 'android', '--no-install']),
    },
    skippable: true,
  })
  push({
    id: 'android.gradle',
    stage: 'build',
    description: `Build app + androidTest APKs (${gradleTasks.join(' ')})`,
    action: {
      type: 'command',
      command: { command: './gradlew', args: gradleTasks, cwd: 'android' },
    },
    skippable: true,
  })
  push({
    id: 'android.install-app',
    stage: 'build',
    description: `Install app APK`,
    action: { type: 'command', command: adb(serial, ['install', '-r', appApk]) },
    skippable: true,
  })
  push({
    id: 'android.install-test',
    stage: 'build',
    description: `Install androidTest APK`,
    action: { type: 'command', command: adb(serial, ['install', '-r', '-t', testApk]) },
    skippable: true,
  })

  // companion — install the token into the app's private files via stdin (the
  // value never touches argv). The redirect MUST run inside the run-as'd app-uid
  // shell, so the whole `run-as … sh -c '…'` script is a single adb-shell arg
  // (see adbShellScript). `mkdir -p files` is defensive: the app's files/ dir is
  // created lazily on first run, and --skip-build may reach here before any
  // launch has created it.
  push({
    id: 'android.install-token',
    stage: 'companion',
    description: 'Install companion token into app private files',
    action: {
      type: 'command',
      command: {
        ...adbShellScript(
          serial,
          `run-as ${android.packageName} sh -c 'mkdir -p files && cat > files/${resolved.deviceTokenFileName} && chmod 600 files/${resolved.deviceTokenFileName}'`,
        ),
        stdinFromFile: resolved.tokenFile,
      },
    },
  })

  // metro — start (or reuse) and wait.
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

  // device — reverse Metro and write the debug host the RN dev support reads.
  push({
    id: 'android.reverse-metro',
    stage: 'device',
    description: `adb reverse tcp:${metro.port}`,
    action: {
      type: 'command',
      command: adb(serial, ['reverse', `tcp:${metro.port}`, `tcp:${metro.port}`]),
    },
  })
  if (metro.port !== DEFAULTS.metroPort) {
    push({
      id: 'android.reverse-default',
      stage: 'device',
      description: `adb reverse tcp:${DEFAULTS.metroPort} -> tcp:${metro.port}`,
      action: {
        type: 'command',
        command: adb(serial, ['reverse', `tcp:${DEFAULTS.metroPort}`, `tcp:${metro.port}`]),
      },
    })
  }
  push({
    id: 'android.debug-host',
    stage: 'device',
    description: 'Write app debug_http_host',
    action: {
      type: 'command',
      command: {
        // Single adb-shell arg so the redirect runs inside the run-as'd app-uid
        // shell (the shared_prefs path is app-private; the outer `shell` uid
        // cannot write it).
        ...adbShellScript(
          serial,
          `run-as ${android.packageName} sh -c 'mkdir -p /data/data/${android.packageName}/shared_prefs && cat > /data/data/${android.packageName}/shared_prefs/${android.packageName}_preferences.xml'`,
        ),
        stdinContents: debugHostXml(`localhost:${metro.port}`),
      },
    },
  })

  // app-launch — first launch + wait for a Hermes target.
  push(launchStep('android.launch-1', android, serial))
  push(hermesStep('android.hermes-1', android, metro, resolved, hermesDeviceName))

  // companion — forward the port (clearing any stale mapping first) and start
  // the instrumentation server, then wait for an authenticated hello.
  push({
    id: 'android.forward-clean',
    stage: 'companion',
    description: `Clear stale adb forward tcp:${resolved.touchPort}`,
    action: {
      type: 'command',
      command: adb(serial, ['forward', '--remove', `tcp:${resolved.touchPort}`]),
      allowFailure: true,
    },
  })
  push({
    id: 'android.forward',
    stage: 'companion',
    description: `adb forward tcp:${resolved.touchPort}`,
    action: {
      type: 'command',
      command: adb(serial, ['forward', `tcp:${resolved.touchPort}`, `tcp:${resolved.touchPort}`]),
    },
  })
  push({
    id: 'android.instrument-start',
    stage: 'companion',
    description: `Start instrumentation companion on port ${resolved.touchPort}`,
    action: {
      type: 'command',
      background: true,
      processKey: 'companion',
      command: adb(serial, [
        'shell',
        'am',
        'instrument',
        '-e',
        'rnDriverAuthTokenFile',
        resolved.deviceTokenFileName,
        '-e',
        'rnDriverPort',
        String(resolved.touchPort),
        '-w',
        resolved.instrumentationTarget,
      ]),
    },
  })
  push({
    id: 'android.instrument-ready',
    stage: 'companion',
    description: 'Wait for companion to accept a hello',
    action: {
      type: 'probe',
      probe: {
        kind: 'instrumentation-hello',
        port: resolved.touchPort,
        tokenFile: resolved.tokenFile,
        timeoutMs: resolved.companionReadyTimeoutMs,
      },
    },
  })

  // app-launch — relaunch so the app picks up the live companion, wait again.
  push(launchStep('android.launch-2', android, serial))
  push(hermesStep('android.hermes-2', android, metro, resolved, hermesDeviceName))

  const cleanup: CleanupAction[] = [
    {
      type: 'kill-process',
      processKey: 'companion',
      description: 'Stop instrumentation companion',
    },
    {
      type: 'command',
      command: adb(serial, ['reverse', '--remove', `tcp:${metro.port}`]),
      description: 'Remove metro reverse',
    },
    {
      type: 'command',
      command: adb(serial, ['forward', '--remove', `tcp:${resolved.touchPort}`]),
      description: 'Remove companion forward',
    },
    {
      type: 'command',
      command: adb(serial, [
        'shell',
        'run-as',
        android.packageName,
        'rm',
        '-f',
        `files/${resolved.deviceTokenFileName}`,
      ]),
      description: 'Remove device token file',
    },
    {
      type: 'command',
      command: adb(serial, ['shell', 'am', 'force-stop', android.packageName]),
      description: 'Force-stop app',
    },
    { type: 'kill-process', processKey: 'metro', description: 'Stop runner-owned Metro' },
    { type: 'remove-file', path: resolved.tokenFile, description: 'Remove per-run token file' },
  ]

  return {
    platform: 'android',
    steps,
    cleanup,
    driverEnv: buildAndroidDriverEnv(resolved, metro, hermesDeviceName, timeoutMs),
    playwright: playwrightCommand(playwright, playwrightArgs),
  }
}

function launchStep(id: string, android: AndroidConfig, serial: string): Step {
  return {
    id,
    stage: 'app-launch',
    description: `Launch ${android.packageName}/${android.activity}`,
    action: {
      type: 'command',
      command: adb(serial, [
        'shell',
        'am',
        'start',
        '-W',
        '-n',
        `${android.packageName}/${android.activity}`,
      ]),
    },
  }
}

function hermesStep(
  id: string,
  android: AndroidConfig,
  metro: ResolvedMetro,
  resolved: ResolvedAndroidTarget,
  deviceNameMatch: string,
): Step {
  return {
    id,
    stage: 'hermes-target',
    description: 'Wait for Hermes target',
    action: {
      type: 'probe',
      probe: {
        kind: 'hermes-target',
        platform: 'android',
        metroUrl: metro.url,
        appId: android.packageName,
        deviceNameMatch,
        timeoutMs: resolved.hermesTimeoutMs,
      },
    },
  }
}

function debugHostXml(host: string): string {
  return `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n  <string name="debug_http_host">${host}</string>\n</map>\n`
}

function adb(serial: string, args: string[]): CommandSpec {
  return { command: 'adb', args: ['-s', serial, ...args] }
}

/**
 * `adb -s <serial> shell <remote>` with the ENTIRE remote command as ONE argv
 * element. Required whenever the remote command uses shell redirection (`>`)
 * inside `run-as`: the process runner spawns adb without a local shell, and
 * `adb shell a b c` re-joins its trailing args and hands them to the device's
 * default shell. If `sh -c <script>` is split across args, that OUTER device
 * shell (uid `shell`, cwd `/`) performs the `>` redirect — not the run-as'd
 * app-uid shell — so the write fails ("can't create files/…: No such file or
 * directory") or hits a permission error on app-private paths. Passing the whole
 * `run-as … sh -c '…'` as one arg (literal inner single-quotes) makes the device
 * shell hand the script to the inner `sh -c`. Mirrors the proven bash recipe's
 * `adb shell "run-as … sh -c '…'"` quoting.
 */
function adbShellScript(serial: string, remote: string): CommandSpec {
  return { command: 'adb', args: ['-s', serial, 'shell', remote] }
}
