import type { Easing, InterpolationOptions } from "./types";
import { resolveEasing } from "./easing";

export const DEFAULT_FRAME_MS = 16;

export type InterpolationDefaults = {
  steps: number;
  easing: Easing;
  duration?: number;
};

export type ResolvedInterpolation = {
  steps: number;
  easing: (t: number) => number;
  stepDelayMs: number | null;
};

export function resolveInterpolation(
  options: InterpolationOptions | undefined,
  defaults: InterpolationDefaults,
): ResolvedInterpolation {
  const easing = resolveEasing(options?.easing, defaults.easing);
  const hasDuration = options?.duration !== undefined;
  const hasSteps = options?.steps !== undefined;

  if (hasDuration) {
    const duration = Math.max(0, options?.duration ?? 0);
    if (duration <= 0) {
      return { steps: 1, easing, stepDelayMs: 0 };
    }
    const steps = Math.max(1, Math.round(duration / DEFAULT_FRAME_MS));
    return { steps, easing, stepDelayMs: duration / steps };
  }

  if (!hasSteps && defaults.duration !== undefined) {
    const duration = Math.max(0, defaults.duration);
    if (duration <= 0) {
      return { steps: 1, easing, stepDelayMs: 0 };
    }
    const steps = Math.max(1, Math.round(duration / DEFAULT_FRAME_MS));
    return { steps, easing, stepDelayMs: duration / steps };
  }

  const steps = Math.max(1, options?.steps ?? defaults.steps);
  return { steps, easing, stepDelayMs: null };
}
