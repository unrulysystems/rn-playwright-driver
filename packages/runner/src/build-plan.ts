import type { Platform, RnDriverConfig } from './config'
import { planAndroid } from './plan/android'
import { planIos } from './plan/ios'
import { placeholderAndroid, placeholderIos, resolveMetro } from './plan/resolved'
import type { Plan } from './plan/types'

export interface MetroOverrides {
  readonly url?: string
  readonly host?: string
  readonly port?: number
}

export interface BuildPlanOptions {
  readonly metroOverrides?: MetroOverrides
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
    return planIos({
      ios,
      metro,
      resolved: placeholderIos(ios, metro),
      playwright: config.playwright,
      timeoutMs: config.timeoutMs,
      specs,
      passthrough,
    })
  }

  const android = config.android
  if (!android) throw new Error('config.android is required to plan the android platform')
  return planAndroid({
    android,
    metro,
    resolved: placeholderAndroid(android, metro),
    playwright: config.playwright,
    timeoutMs: config.timeoutMs,
    specs,
    passthrough,
    hermesDeviceName: '<android-device>',
  })
}
