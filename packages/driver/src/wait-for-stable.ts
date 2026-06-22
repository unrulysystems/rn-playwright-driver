/** Default budget for a stabilization wait, in ms. */
const DEFAULT_STABLE_TIMEOUT = 2_000
/** Default delay between stabilization samples, in ms. */
const DEFAULT_STABLE_POLL_INTERVAL = 100

/** The timer dependency waitForStable needs — satisfied by a Device. */
export interface WaitForStableTimer {
  waitForTimeout(ms: number): Promise<void>
}

export interface WaitForStableOptions<T> {
  /** Max time to wait for stabilization, ms (default {@link DEFAULT_STABLE_TIMEOUT}). */
  timeout?: number
  /** Delay between samples, ms (default {@link DEFAULT_STABLE_POLL_INTERVAL}). */
  pollInterval?: number
  /** Equality deciding two consecutive samples are "the same" (default Object.is). */
  equals?: (a: T, b: T) => boolean
  /** Clock source, injectable for tests (default Date.now). */
  now?: () => number
}

/**
 * Poll `sample` until two consecutive samples are equal (the value has settled)
 * or `timeout` elapses. The first wait happens BEFORE the first sample — the
 * caller has just triggered motion (e.g. a scroll) and we let it begin before
 * watching it settle. Bounded; never throws.
 *
 * The sampler returns `undefined` to signal "stop now" — e.g. the thing being
 * sampled is no longer measurable — and the loop returns immediately. Because
 * `undefined` is the stop sentinel, `T` values are never `undefined`.
 */
export async function waitForStable<T>(
  sample: () => Promise<T | undefined>,
  timer: WaitForStableTimer,
  options: WaitForStableOptions<T> = {},
): Promise<void> {
  const timeout = options.timeout ?? DEFAULT_STABLE_TIMEOUT
  const pollInterval = options.pollInterval ?? DEFAULT_STABLE_POLL_INTERVAL
  const equals = options.equals ?? Object.is
  const now = options.now ?? Date.now
  const deadline = now() + timeout

  let previous: T | undefined

  while (now() < deadline) {
    await timer.waitForTimeout(pollInterval)
    const current = await sample()
    if (current === undefined) {
      return
    }
    if (previous !== undefined && equals(previous, current)) {
      return
    }
    previous = current
  }
}
