import { resolveEasing } from './easing'
import type { Easing, InterpolationOptions } from './types'

export const DEFAULT_FRAME_MS = 16

export type InterpolationDefaults = {
  steps: number
  easing: Easing
  duration?: number
}

export type ResolvedInterpolation = {
  steps: number
  easing: (t: number) => number
  stepDelayMs: number | null
}

export function resolveInterpolation(
  options: InterpolationOptions | undefined,
  defaults: InterpolationDefaults,
): ResolvedInterpolation {
  const easing = resolveEasing(options?.easing, defaults.easing)
  const hasDuration = options?.duration !== undefined
  const hasSteps = options?.steps !== undefined

  if (hasDuration) {
    return resolveDurationInterpolation(options?.duration ?? 0, easing)
  }

  if (!hasSteps && defaults.duration !== undefined) {
    return resolveDurationInterpolation(defaults.duration, easing)
  }

  const steps = Math.max(1, options?.steps ?? defaults.steps)
  return { steps, easing, stepDelayMs: null }
}

function resolveDurationInterpolation(
  duration: number,
  easing: (t: number) => number,
): ResolvedInterpolation {
  const clamped = Math.max(0, duration)
  if (clamped <= 0) {
    return { steps: 1, easing, stepDelayMs: 0 }
  }
  const steps = Math.max(1, Math.round(clamped / DEFAULT_FRAME_MS))
  return { steps, easing, stepDelayMs: clamped / steps }
}
