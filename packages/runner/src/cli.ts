import { mkdtemp } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { buildDryRunPlan } from './build-plan'
import type { Platform, RnDriverConfig } from './config'
import { ConfigNotFoundError, loadConfig } from './load-config'
import { planAndroid } from './plan/android'
import { planIos } from './plan/ios'
import { resolveMetro } from './plan/resolved'
import type { Plan, Stage } from './plan/types'
import { renderPlan } from './print-plan'
import { executePlan, StageError } from './runner/execute'
import { NodeProcessRunner } from './runner/process-runner'
import { resolveAndroidTarget, resolveIosTarget } from './runner/resolve'
import { ConfigValidationError, assertValid } from './validate'

interface CliFlags {
  readonly platform: string | undefined
  readonly config: string | undefined
  readonly device: string | undefined
  readonly dryRun: boolean
  readonly skipBuild: boolean
  readonly verbose: boolean
  readonly help: boolean
}

/** Distinct non-zero exit codes per lifecycle stage so a failure is attributable. */
const STAGE_EXIT_CODES: Record<Stage, number> = {
  config: 10,
  metro: 11,
  device: 12,
  build: 13,
  companion: 14,
  'app-launch': 15,
  'hermes-target': 16,
  playwright: 1,
  cleanup: 17,
}

export async function run(argv: string[]): Promise<number> {
  const { command, specs, passthrough, flags } = parseCliArgs(argv)

  if (flags.help) {
    printHelp()
    return 0
  }
  if (command !== 'test') {
    process.stderr.write(`Unknown command: ${command ?? '(none)'}\n`)
    printHelp()
    return 2
  }

  let platforms: Platform[]
  try {
    platforms = resolvePlatforms(flags.platform)
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`)
    return 2
  }

  let config: RnDriverConfig
  try {
    const loaded = await loadConfig({
      cwd: process.cwd(),
      ...(flags.config ? { configPath: flags.config } : {}),
    })
    assertValid(loaded.config, platforms)
    config = loaded.config
  } catch (error) {
    if (error instanceof ConfigValidationError || error instanceof ConfigNotFoundError) {
      process.stderr.write(`${error.message}\n`)
      return 2
    }
    throw error
  }

  const playwrightArgs = [...specs, ...passthrough]

  if (flags.dryRun) {
    for (const platform of platforms) {
      process.stdout.write(
        `${renderPlan(buildDryRunPlan(config, platform, { playwrightArgs }))}\n\n`,
      )
    }
    return 0
  }

  const runner = new NodeProcessRunner()
  const logDir = await mkdtemp(path.join(tmpdir(), 'rn-driver-logs-'))
  let exitCode = 0
  for (const platform of platforms) {
    runner.log(`\n=== platform: ${platform} ===`)
    const code = await runPlatform(platform, config, { runner, logDir, flags, playwrightArgs })
    if (code !== 0) exitCode = code
  }
  return exitCode
}

interface RunContext {
  readonly runner: NodeProcessRunner
  readonly logDir: string
  readonly flags: CliFlags
  readonly playwrightArgs: readonly string[]
}

async function runPlatform(
  platform: Platform,
  config: RnDriverConfig,
  ctx: RunContext,
): Promise<number> {
  const metro = resolveMetro(config.metro)
  let plan: Plan
  if (platform === 'ios') {
    if (!config.ios) throw new Error('config.ios is required for the ios platform')
    const resolved = await resolveIosTarget(config.ios, metro, deviceOpt(ctx.flags.device))
    plan = planIos({
      ios: config.ios,
      metro,
      resolved,
      playwright: config.playwright,
      timeoutMs: config.timeoutMs,
      playwrightArgs: ctx.playwrightArgs,
    })
  } else {
    if (!config.android) throw new Error('config.android is required for the android platform')
    const { resolved, deviceName } = await resolveAndroidTarget(
      config.android,
      metro,
      deviceOpt(ctx.flags.device),
    )
    plan = planAndroid({
      android: config.android,
      metro,
      resolved,
      playwright: config.playwright,
      timeoutMs: config.timeoutMs,
      playwrightArgs: ctx.playwrightArgs,
      hermesDeviceName: deviceName,
    })
  }

  const reuseMetro = metro.reuseExisting && (await metroRunning(metro.url))
  if (reuseMetro) ctx.runner.log(`Reusing Metro already running at ${metro.url}`)

  // Metro preflight (REQ-METRO-003): when the runner owns Metro, the port must be
  // free up front. metro.command pins the port, so the runner fails fast with an
  // actionable message rather than letting Expo silently bind a different port
  // the readiness probe would never find.
  if (!metro.reuseExisting && (await portInUse(metro.host, metro.port))) {
    process.stderr.write(
      `\nFAILED [${platform}] at stage [metro] metro.preflight: ${metro.host}:${metro.port} is already in use. Free it, set metro.reuseExisting, or choose another metro.port.\n`,
    )
    return STAGE_EXIT_CODES.metro
  }

  try {
    const result = await executePlan(plan, ctx.runner, {
      logDir: ctx.logDir,
      skipBuild: ctx.flags.skipBuild,
      verbose: ctx.flags.verbose,
      skipStep: (step) => reuseMetro && step.id === 'metro.start',
      skipCleanup: (action) =>
        reuseMetro && action.type === 'kill-process' && action.processKey === 'metro',
    })
    if (result.playwrightCode === 0) {
      ctx.runner.log(`PASS: ${platform} e2e`)
    } else {
      ctx.runner.log(`FAIL: ${platform} Playwright exited ${result.playwrightCode}`)
    }
    return result.playwrightCode
  } catch (error) {
    if (error instanceof StageError) {
      process.stderr.write(
        `\nFAILED [${platform}] at stage [${error.stage}] ${error.stepId}: ${error.message}\n`,
      )
      process.stderr.write(`Logs: ${ctx.logDir}\n`)
      return STAGE_EXIT_CODES[error.stage]
    }
    throw error
  }
}

function deviceOpt(device: string | undefined): { device?: string } {
  return device ? { device } : {}
}

async function metroRunning(metroUrl: string): Promise<boolean> {
  try {
    // Bounded: a server that accepts the socket but never responds must not wedge
    // the reuse-existing preflight before any plan step runs.
    const response = await fetch(`${metroUrl}/status`, { signal: AbortSignal.timeout(2_000) })
    return (await response.text()).includes('packager-status:running')
  } catch {
    return false
  }
}

/** True if something already accepts a TCP connection on host:port. */
function portInUse(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const finish = (inUse: boolean): void => {
      socket.destroy()
      resolve(inUse)
    }
    socket.setTimeout(1_000)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function resolvePlatforms(platform: string | undefined): Platform[] {
  if (!platform) throw new Error('--platform <ios|android|all> is required')
  if (platform === 'all') return ['ios', 'android']
  if (platform === 'ios' || platform === 'android') return [platform]
  throw new Error(`--platform must be one of ios, android, all (got: ${platform})`)
}

function parseCliArgs(argv: string[]): {
  command: string | undefined
  specs: string[]
  passthrough: string[]
  flags: CliFlags
} {
  const dashDash = argv.indexOf('--')
  const before = dashDash === -1 ? argv : argv.slice(0, dashDash)
  const passthrough = dashDash === -1 ? [] : argv.slice(dashDash + 1)

  const { values, positionals } = parseArgs({
    args: before,
    options: {
      platform: { type: 'string', short: 'p' },
      config: { type: 'string', short: 'c' },
      device: { type: 'string', short: 'd' },
      'dry-run': { type: 'boolean' },
      'skip-build': { type: 'boolean' },
      verbose: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  })

  const [command = 'test', ...specs] = positionals
  return {
    command,
    specs,
    passthrough,
    flags: {
      platform: values.platform,
      config: values.config,
      device: values.device,
      dryRun: values['dry-run'] ?? false,
      skipBuild: values['skip-build'] ?? false,
      verbose: values.verbose ?? false,
      help: values.help ?? false,
    },
  }
}

function printHelp(): void {
  process.stdout.write(`
rn-driver — config-backed cross-platform RN Playwright e2e runner

Usage:
  rn-driver test --platform <ios|android|all> [options] [specs...] [-- <playwright args>]

Options:
  -p, --platform   ios | android | all                       (required)
  -c, --config     Path to rn-driver.config.{ts,mjs,js}      (default: searched upward)
  -d, --device     Simulator udid / emulator serial override
      --dry-run    Print the resolved plan and exit (no side effects)
      --skip-build Reuse an already-built native project
      --verbose    Stream per-step progress
  -h, --help       Show help

Examples:
  rn-driver test --platform ios
  rn-driver test --platform android --skip-build
  rn-driver test --platform all --dry-run
  rn-driver test --platform ios e2e/integration/counter.spec.ts
`)
}
