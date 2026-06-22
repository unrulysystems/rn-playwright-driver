import { describe, expect, it } from 'vitest'

import { type WaitForStableTimer, waitForStable } from './wait-for-stable'

/**
 * A timer whose waitForTimeout advances a logical clock, so `now` (reading that
 * clock) moves deterministically with each poll — no real time, no fake-timer
 * plumbing.
 */
function clockTimer(): { timer: WaitForStableTimer; now: () => number; waits: number[] } {
  let clock = 0
  const waits: number[] = []
  return {
    timer: {
      waitForTimeout: async (ms: number) => {
        clock += ms
        waits.push(ms)
      },
    },
    now: () => clock,
    waits,
  }
}

describe('waitForStable', () => {
  it('resolves once two consecutive samples are equal', async () => {
    const { timer, now } = clockTimer()
    const positions = [10, 5, 5, 5]
    let i = 0

    await waitForStable(async () => positions[i++], timer, { now })

    // 10 (set) -> 5 (differs, set) -> 5 (equals previous, stop). Three samples.
    expect(i).toBe(3)
  })

  it('stops immediately when the sampler returns undefined', async () => {
    const { timer, now } = clockTimer()
    let calls = 0

    await waitForStable(
      async () => {
        calls++
        return undefined
      },
      timer,
      { now },
    )

    expect(calls).toBe(1)
  })

  it('gives up after the timeout when the value never settles', async () => {
    const { timer, now } = clockTimer()
    let samples = 0

    await waitForStable(
      async () => {
        samples++
        return samples // always different — never stabilizes
      },
      timer,
      { timeout: 250, pollInterval: 100, now },
    )

    // deadline = 250; clock advances 100 per poll: samples at clock 100, 200, 300.
    expect(samples).toBe(3)
  })

  it('uses the provided equality for tolerant comparison', async () => {
    const { timer, now } = clockTimer()
    const positions = [100, 100.4]
    let i = 0

    await waitForStable(async () => positions[i++], timer, {
      now,
      equals: (a, b) => Math.abs(a - b) < 1,
    })

    // 100 (set) -> 100.4 (within tolerance of 100, stop). Two samples.
    expect(i).toBe(2)
  })

  it('waits before taking the first sample', async () => {
    const { timer: base, now } = clockTimer()
    const order: string[] = []
    const timer: WaitForStableTimer = {
      waitForTimeout: async (ms) => {
        order.push('wait')
        await base.waitForTimeout(ms)
      },
    }

    await waitForStable(
      async () => {
        order.push('sample')
        return 1 // stable on the second sample
      },
      timer,
      { now },
    )

    expect(order.slice(0, 2)).toEqual(['wait', 'sample'])
  })
})
