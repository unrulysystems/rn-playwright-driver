import type { Platform, RnDriverConfig } from './config'
import { planAndroid } from './plan/android'
import { planIos } from './plan/ios'
import { placeholderAndroid, placeholderIos, resolveMetro } from './plan/resolved'
import type { Plan } from './plan/types'
import {
  androidRunnerTarget,
  applyTargetHook,
  iosRunnerTarget,
  targetHookContribution,
} from './target-hooks'

export interface MetroOverrides {
  readonly url?: string
  readonly host?: string
  readonly port?: number
}

export interface BuildPlanOptions {
  readonly metroOverrides?: MetroOverrides
  /** App directory: Expo, native builds, Metro and native paths run relative to it. */
  readonly projectCwd?: string
  /**
   * Directory of the rn-driver config file. Playwright runs here. Defaults to
   * `projectCwd`; differs only when the config sets `projectRoot` (REQ-CFG-007).
   */
  readonly configCwd?: string
  /** Positional spec paths; override the config spec list when non-empty. */
  readonly specs?: readonly string[]
  /** Args after `--`; always appended to the Playwright invocation. */
  readonly passthrough?: readonly string[]
}

/**
 * Build the plan for a platform using placeholder (no-I/O) resolution. This is
 * the `--dry-run` path and the unit-test entry point: identical config yields an
 * identical plan with zero side effects.
 */
export function buildDryRunPlan(
  config: RnDriverConfig,
  platform: Platform,
  opts: BuildPlanOptions = {},
): Plan {
  const metro = resolveMetro(config.metro, opts.metroOverrides ?? {})
  const specs = opts.specs ?? []
  const passthrough = opts.passthrough ?? []

  if (platform === 'ios') {
    const ios = config.ios
    if (!ios) throw new Error('config.ios is required to plan the ios platform')
    const resolved = placeholderIos(ios, metro)
    const plan = planIos({
      ios,
      metro,
      resolved,
      playwright: config.playwright,
      timeoutMs: config.timeoutMs,
      ...(opts.projectCwd ? { projectCwd: opts.projectCwd } : {}),
      ...(opts.configCwd ? { configCwd: opts.configCwd } : {}),
      specs,
      passthrough,
    })
    return applyTargetHook(plan, targetHookContribution(config, iosRunnerTarget(ios, resolved)))
  }

  const android = config.android
  if (!android) throw new Error('config.android is required to plan the android platform')
  const resolved = placeholderAndroid(android, metro)
  const hermesDeviceName = '<android-device>'
  const plan = planAndroid({
    android,
    metro,
    resolved,
    playwright: config.playwright,
    timeoutMs: config.timeoutMs,
    ...(opts.projectCwd ? { projectCwd: opts.projectCwd } : {}),
    ...(opts.configCwd ? { configCwd: opts.configCwd } : {}),
    specs,
    passthrough,
    hermesDeviceName,
  })
  return applyTargetHook(
    plan,
    targetHookContribution(config, androidRunnerTarget(android, resolved, metro, hermesDeviceName)),
  )
}
