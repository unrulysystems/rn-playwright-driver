import type { Easing } from "./types";

export type EasingFunction = (t: number) => number;

const easingMap: Record<Exclude<Easing, EasingFunction>, EasingFunction> = {
  "linear": (t) => t,
  "ease-in": (t) => t * t,
  "ease-out": (t) => 1 - (1 - t) * (1 - t),
  "ease-in-out": (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
};

export function resolveEasing(easing: Easing | undefined, fallback: Easing): EasingFunction {
  if (typeof easing === "function") {
    return easing;
  }
  if (typeof fallback === "function") {
    return fallback;
  }
  return easingMap[easing ?? fallback];
}
