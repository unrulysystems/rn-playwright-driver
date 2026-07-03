import type {
  AndroidConfig,
  IosConfig,
  RnDriverConfig,
  RunnerTarget,
  TargetHookContribution,
} from './config'
import type { ResolvedAndroidTarget, ResolvedIosTarget, ResolvedMetro } from './plan/resolved'
import type { CleanupAction, CommandSpec, Plan, Stage, Step, StepAction } from './plan/types'

interface NormalizedTargetHook {
  readonly metroEnv: Readonly<Record<string, string>>
  readonly playwrightEnv: Readonly<Record<string, string>>
  readonly beforeMetro: readonly Step[]
  readonly afterMetroReady: readonly Step[]
  readonly beforeLaunch: readonly Step[]
  readonly cleanup: readonly CleanupAction[]
}

const EMPTY_HOOK: NormalizedTargetHook = {
  metroEnv: {},
  playwrightEnv: {},
  beforeMetro: [],
  afterMetroReady: [],
  beforeLaunch: [],
  cleanup: [],
}

const STAGES: readonly Stage[] = [
  'config',
  'metro',
  'device',
  'build',
  'companion',
  'app-launch',
  'hermes-target',
  'playwright',
  'cleanup',
]

export class TargetHookError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TargetHookError'
  }
}

export function iosRunnerTarget(ios: IosConfig, resolved: ResolvedIosTarget): RunnerTarget {
  return {
    platform: 'ios',
    kind: resolved.kind,
    id: resolved.id,
    deviceName: resolved.deviceName,
    appId: ios.bundleId,
    metroUrl: resolved.initialUrl,
  }
}

export function androidRunnerTarget(
  android: AndroidConfig,
  resolved: ResolvedAndroidTarget,
  metro: ResolvedMetro,
  deviceName: string,
): RunnerTarget {
  return {
    platform: 'android',
    kind: androidTargetKind(resolved.serial),
    id: resolved.serial,
    deviceName,
    appId: android.packageName,
    metroUrl: metro.url,
  }
}

export function targetHookContribution(
  config: RnDriverConfig,
  target: RunnerTarget,
): NormalizedTargetHook {
  const configureTarget = config.hooks?.configureTarget
  if (!configureTarget) return EMPTY_HOOK

  let raw: TargetHookContribution | undefined
  try {
    raw = configureTarget(target)
  } catch (error) {
    throw new TargetHookError(`config.hooks.configureTarget failed: ${errorMessage(error)}`)
  }
  if (raw === undefined) return EMPTY_HOOK
  if (!isRecord(raw)) {
    throw new TargetHookError('config.hooks.configureTarget: expected an object return value')
  }
  const rawEnv = optionalRecord(raw.env, 'config.hooks.configureTarget.env')
  const rawSteps = optionalRecord(raw.steps, 'config.hooks.configureTarget.steps')

  return {
    metroEnv: envRecord(rawEnv?.metro, 'config.hooks.configureTarget.env.metro'),
    playwrightEnv: envRecord(rawEnv?.playwright, 'config.hooks.configureTarget.env.playwright'),
    beforeMetro: projectSteps(
      arrayValue(rawSteps?.beforeMetro, 'config.hooks.configureTarget.steps.beforeMetro'),
      'config.hooks.configureTarget.steps.beforeMetro',
      'metro',
    ),
    afterMetroReady: projectSteps(
      arrayValue(rawSteps?.afterMetroReady, 'config.hooks.configureTarget.steps.afterMetroReady'),
      'config.hooks.configureTarget.steps.afterMetroReady',
      'device',
    ),
    beforeLaunch: projectSteps(
      arrayValue(rawSteps?.beforeLaunch, 'config.hooks.configureTarget.steps.beforeLaunch'),
      'config.hooks.configureTarget.steps.beforeLaunch',
      'app-launch',
    ),
    cleanup: projectCleanup(
      arrayValue(raw.cleanup, 'config.hooks.configureTarget.cleanup'),
      'config.hooks.configureTarget.cleanup',
    ),
  }
}

export function applyTargetHook(plan: Plan, hook: NormalizedTargetHook): Plan {
  const withMetroEnv = plan.steps.map((step) =>
    step.id === 'metro.start' ? withCommandEnv(step, hook.metroEnv) : step,
  )
  const steps = insertHookSteps(withMetroEnv, plan.platform, hook)
  return {
    ...plan,
    steps,
    cleanup: [...hook.cleanup, ...plan.cleanup],
    playwright: {
      ...plan.playwright,
      env: mergeEnv(hook.playwrightEnv, plan.playwright.env ?? {}),
    },
  }
}

function androidTargetKind(serial: string): 'emulator' | 'device' {
  return serial === '<android-serial>' || serial.startsWith('emulator-') ? 'emulator' : 'device'
}

function withCommandEnv(step: Step, env: Readonly<Record<string, string>>): Step {
  if (Object.keys(env).length === 0) return step
  if (step.action.type !== 'command') return step
  return {
    ...step,
    action: {
      ...step.action,
      command: {
        ...step.action.command,
        env: mergeEnv(env, step.action.command.env ?? {}),
      },
    },
  }
}

function insertHookSteps(
  steps: readonly Step[],
  platform: Plan['platform'],
  hook: NormalizedTargetHook,
): readonly Step[] {
  let next = insertBefore(steps, 'metro.start', hook.beforeMetro)
  next = insertAfter(next, 'metro.ready', hook.afterMetroReady)
  const launchAnchor =
    platform === 'android'
      ? 'android.launch-1'
      : firstExistingStep(next, [
          'ios.terminate-before-launch',
          'ios.launch',
          'ios.companion-start',
        ])
  return insertBefore(next, launchAnchor, hook.beforeLaunch)
}

function insertBefore(
  steps: readonly Step[],
  anchor: string,
  inserted: readonly Step[],
): readonly Step[] {
  if (inserted.length === 0) return steps
  const index = steps.findIndex((step) => step.id === anchor)
  if (index === -1) throw new TargetHookError(`target hook insertion anchor not found: ${anchor}`)
  return [...steps.slice(0, index), ...inserted, ...steps.slice(index)]
}

function insertAfter(
  steps: readonly Step[],
  anchor: string,
  inserted: readonly Step[],
): readonly Step[] {
  if (inserted.length === 0) return steps
  const index = steps.findIndex((step) => step.id === anchor)
  if (index === -1) throw new TargetHookError(`target hook insertion anchor not found: ${anchor}`)
  return [...steps.slice(0, index + 1), ...inserted, ...steps.slice(index + 1)]
}

function firstExistingStep(steps: readonly Step[], anchors: readonly string[]): string {
  const found = anchors.find((anchor) => steps.some((step) => step.id === anchor))
  if (!found) throw new TargetHookError(`target hook insertion anchor not found: ${anchors[0]}`)
  return found
}

function projectSteps(
  value: readonly unknown[] | undefined,
  path: string,
  defaultStage: Stage,
): readonly Step[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new TargetHookError(`${path}: expected an array`)
  return value.map((item, index) => projectStep(item, `${path}[${index}]`, defaultStage))
}

function projectStep(value: unknown, path: string, defaultStage: Stage): Step {
  if (!isRecord(value)) throw new TargetHookError(`${path}: expected an object`)
  const id = requiredString(value.id, `${path}.id`)
  const description = requiredString(value.description, `${path}.description`)
  const stage = stageValue(value.stage, `${path}.stage`, defaultStage)
  const command = commandSpec(value.command, `${path}.command`)
  const action: StepAction = {
    type: 'command',
    command,
    ...(value.background === undefined
      ? {}
      : { background: booleanValue(value.background, `${path}.background`) }),
    ...(value.processKey === undefined
      ? {}
      : { processKey: requiredString(value.processKey, `${path}.processKey`) }),
    ...(value.allowFailure === undefined
      ? {}
      : { allowFailure: booleanValue(value.allowFailure, `${path}.allowFailure`) }),
  }
  return { id, stage, description, action }
}

function projectCleanup(
  value: readonly unknown[] | undefined,
  path: string,
): readonly CleanupAction[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new TargetHookError(`${path}: expected an array`)
  return value.map((item, index) => {
    if (!isRecord(item)) throw new TargetHookError(`${path}[${index}]: expected an object`)
    return {
      type: 'command',
      description: requiredString(item.description, `${path}[${index}].description`),
      command: commandSpec(item.command, `${path}[${index}].command`),
    }
  })
}

function commandSpec(value: unknown, path: string): CommandSpec {
  if (!isRecord(value)) throw new TargetHookError(`${path}: expected an object`)
  const command = requiredString(value.command, `${path}.command`)
  const args = stringArray(value.args, `${path}.args`)
  return {
    command,
    args,
    ...(value.env === undefined ? {} : { env: envRecord(value.env, `${path}.env`) }),
    ...(value.cwd === undefined ? {} : { cwd: requiredString(value.cwd, `${path}.cwd`) }),
    ...(value.packageBin === undefined
      ? {}
      : { packageBin: booleanValue(value.packageBin, `${path}.packageBin`) }),
    ...(value.stdinFromFile === undefined
      ? {}
      : { stdinFromFile: requiredString(value.stdinFromFile, `${path}.stdinFromFile`) }),
    ...(value.stdinContents === undefined
      ? {}
      : { stdinContents: requiredString(value.stdinContents, `${path}.stdinContents`) }),
  }
}

function envRecord(value: unknown, path: string): Readonly<Record<string, string>> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new TargetHookError(`${path}: expected an object of string values`)
  const out: Record<string, string> = {}
  for (const [key, envValue] of Object.entries(value)) {
    if (typeof envValue !== 'string') throw new TargetHookError(`${path}.${key}: expected a string`)
    if (looksLikeInlineSecretKey(key)) {
      throw new TargetHookError(
        `${path}.${key}: inline secret/token env keys are not allowed; pass secret material by file path`,
      )
    }
    out[key] = envValue
  }
  return out
}

function looksLikeInlineSecretKey(key: string): boolean {
  const upper = key.toUpperCase()
  if (upper.endsWith('_TOKEN_FILE')) return false
  return upper === 'TOKEN' || upper.endsWith('_TOKEN') || upper.includes('SECRET')
}

function mergeEnv(
  lowerPriority: Readonly<Record<string, string>>,
  higherPriority: Readonly<Record<string, string>>,
): Record<string, string> {
  return { ...lowerPriority, ...higherPriority }
}

function stageValue(value: unknown, path: string, fallback: Stage): Stage {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !STAGES.includes(value as Stage)) {
    throw new TargetHookError(`${path}: expected one of ${STAGES.join(', ')}`)
  }
  return value as Stage
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new TargetHookError(`${path}: expected an array of strings`)
  }
  return value
}

function arrayValue(value: unknown, path: string): readonly unknown[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new TargetHookError(`${path}: expected an array`)
  return value
}

function optionalRecord(value: unknown, path: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new TargetHookError(`${path}: expected an object`)
  return value
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TargetHookError(`${path}: expected a non-empty string`)
  }
  return value
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new TargetHookError(`${path}: expected a boolean`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
