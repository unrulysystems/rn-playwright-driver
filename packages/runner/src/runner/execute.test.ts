import { describe, expect, it } from 'vitest'
import { buildDryRunPlan } from '../build-plan'
import { configFixture } from '../fixtures'
import type { CommandSpec, ProbeWatch, ProcessRunner, ReadinessProbe } from '../plan/types'
import { executePlan, StageError } from './execute'
import { ProbeFailure } from './probe-failure'

interface Recorded {
  readonly type: 'exec' | 'spawn' | 'kill' | 'write' | 'rm' | 'free' | 'probe'
  readonly label: string
  readonly spec?: CommandSpec
  /** The probe's early-abort watch, recorded so tests can assert the executor wired it through. */
  readonly watch?: ProbeWatch | undefined
}

function makeRunner(
  opts: {
    execCode?: (spec: CommandSpec) => number
    probeResult?: (probe: ReadinessProbe) => boolean
    /** Simulate the real probe's fast-fail: return a marker for a probe to throw ProbeFailure. */
    probeFailure?: (probe: ReadinessProbe) => string | null
  } = {},
): { runner: ProcessRunner; calls: Recorded[] } {
  const calls: Recorded[] = []
  const alive = new Map<string, boolean>()
  const runner: ProcessRunner = {
    exec(spec) {
      calls.push({ type: 'exec', label: `${spec.command} ${spec.args.join(' ')}`, spec })
      return Promise.resolve({ code: opts.execCode?.(spec) ?? 0, stdout: '', stderr: '' })
    },
    spawn(spec, o) {
      calls.push({ type: 'spawn', label: o.key, spec })
      alive.set(o.key, true)
      return { key: o.key, pid: 4242 }
    },
    isAlive(handle) {
      return alive.get(handle.key) ?? false
    },
    kill(handle) {
      calls.push({ type: 'kill', label: handle.key })
      alive.set(handle.key, false)
      return Promise.resolve()
    },
    writeFile(path) {
      calls.push({ type: 'write', label: path })
      return Promise.resolve()
    },
    removeFile(path) {
      calls.push({ type: 'rm', label: path })
      return Promise.resolve()
    },
    freePort(port) {
      calls.push({ type: 'free', label: String(port) })
      return Promise.resolve()
    },
    probe(probe, isAlive, watch) {
      calls.push({ type: 'probe', label: probe.kind, watch })
      // Mirror production: a terminal build/test failure marker in the watched log throws
      // ProbeFailure (early abort) — only possible when the executor wired a `watch` through.
      if (watch && opts.probeFailure) {
        const marker = opts.probeFailure(probe)
        if (marker) return Promise.reject(new ProbeFailure(marker, 'simulated build log tail'))
      }
      // Mirror production: probe() fails fast when its backing process is dead,
      // so the mock must honor the isAlive callback rather than ignore it.
      if (!isAlive()) return Promise.resolve(false)
      return Promise.resolve(opts.probeResult ? opts.probeResult(probe) : true)
    },
    log() {},
  }
  return { runner, calls }
}

const labels = (calls: Recorded[], type: Recorded['type']) =>
  calls.filter((c) => c.type === type).map((c) => c.label)
const order = (calls: Recorded[], pred: (c: Recorded) => boolean) => calls.findIndex(pred)

describe('executePlan (iOS plan against a mock runner)', () => {
  const plan = buildDryRunPlan(configFixture(), 'ios')

  it('runs the full lifecycle then Playwright, and returns the Playwright exit code', async () => {
    const { runner, calls } = makeRunner({
      execCode: (s) => (s.args.includes('playwright') ? 7 : 0),
    })
    const result = await executePlan(plan, runner, { logDir: '/tmp/logs' })

    expect(result.playwrightCode).toBe(7)
    expect(labels(calls, 'spawn')).toEqual(['metro', 'companion'])
    // Playwright runs after the companion is up.
    const playwrightAt = order(
      calls,
      (c) => c.type === 'exec' && (c.spec?.args.includes('playwright') ?? false),
    )
    const companionReadyAt = order(calls, (c) => c.type === 'probe' && c.label === 'xctest-hello')
    expect(playwrightAt).toBeGreaterThan(companionReadyAt)
  })

  it('gates: a background process is spawned before its readiness probe', async () => {
    const { runner, calls } = makeRunner()
    await executePlan(plan, runner, { logDir: '/tmp/logs' })
    expect(order(calls, (c) => c.type === 'spawn' && c.label === 'metro')).toBeLessThan(
      order(calls, (c) => c.type === 'probe' && c.label === 'metro-status'),
    )
    expect(order(calls, (c) => c.type === 'spawn' && c.label === 'companion')).toBeLessThan(
      order(calls, (c) => c.type === 'probe' && c.label === 'xctest-hello'),
    )
  })

  it('attributes a readiness timeout to its stage and still runs cleanup', async () => {
    const { runner, calls } = makeRunner({ probeResult: (p) => p.kind !== 'xctest-hello' })
    const error = await executePlan(plan, runner, { logDir: '/tmp/logs' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StageError)
    expect(error).toMatchObject({ stage: 'companion', stepId: 'ios.companion-ready' })
    // Cleanup is defensive and runs on the failure path.
    expect(labels(calls, 'kill')).toEqual(expect.arrayContaining(['companion', 'metro']))
    expect(labels(calls, 'free')).toContain('9999')
    expect(labels(calls, 'rm')).toContain('<token-file>')
    // Playwright never ran.
    expect(calls.some((c) => c.spec?.args.includes('playwright'))).toBe(false)
  })

  it('fast-fails the companion stage when xcodebuild reports a build failure (no readiness wait)', async () => {
    const { runner, calls } = makeRunner({
      probeFailure: (p) => (p.kind === 'xctest-hello' ? '** BUILD FAILED **' : null),
    })
    const error = await executePlan(plan, runner, { logDir: '/tmp/logs' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StageError)
    expect(error).toMatchObject({ stage: 'companion', stepId: 'ios.companion-ready' })
    // The real build failure is surfaced, NOT an opaque readiness timeout.
    expect((error as StageError).message).toContain('** BUILD FAILED **')
    expect((error as StageError).message).not.toContain('readiness timed out')
    // The executor wired the early-abort watch (companion log path + ios markers) into the probe.
    const companionProbe = calls.find((c) => c.type === 'probe' && c.label === 'xctest-hello')
    expect(companionProbe?.watch?.failureMarkers).toEqual(
      expect.arrayContaining(['** BUILD FAILED **', '** TEST FAILED **']),
    )
    expect(companionProbe?.watch?.logPath).toContain('companion')
    // Cleanup still runs defensively; Playwright never does.
    expect(labels(calls, 'kill')).toEqual(expect.arrayContaining(['companion', 'metro']))
    expect(calls.some((c) => c.spec?.args.includes('playwright'))).toBe(false)
  })

  it('skip-build skips skippable steps but keeps the token/config refresh', async () => {
    const { runner, calls } = makeRunner()
    await executePlan(plan, runner, { logDir: '/tmp/logs', skipBuild: true })
    const execLabels = labels(calls, 'exec').join('\n')
    expect(execLabels).not.toContain('expo prebuild')
    expect(execLabels).not.toContain('pod install')
    // The runtime-config write is not skippable.
    expect(labels(calls, 'write')).toContain('<runtime-config>')
  })

  it('honors skipStep/skipCleanup so a reused Metro is neither started nor killed', async () => {
    const { runner, calls } = makeRunner()
    const result = await executePlan(plan, runner, {
      logDir: '/tmp/logs',
      skipStep: (step) => step.id === 'metro.start',
      skipCleanup: (action) => action.type === 'kill-process' && action.processKey === 'metro',
    })
    expect(labels(calls, 'spawn')).not.toContain('metro')
    expect(labels(calls, 'kill')).not.toContain('metro')
    // The companion is still managed.
    expect(labels(calls, 'spawn')).toContain('companion')
    expect(labels(calls, 'kill')).toContain('companion')
    // REGRESSION (reused Metro): metro.start is skipped, so there is no metro
    // process handle. metro.ready must NOT fail-fast on the missing handle (the
    // reused Metro is external) — the run must still reach Playwright. Because
    // the mock probe now honors isAlive, a regression in execute's "no handle =>
    // alive" gating would surface here as a metro-stage StageError.
    expect(labels(calls, 'probe')).toContain('metro-status')
    expect(calls.some((c) => c.spec?.args.includes('playwright'))).toBe(true)
    expect(result.playwrightCode).toBe(0)
  })

  it('REQ-AND-005: re-issues am start when a Hermes probe misses, then proceeds', async () => {
    const androidPlan = buildDryRunPlan(configFixture(), 'android')
    let hermesProbes = 0
    const { runner, calls } = makeRunner({
      probeResult: (p) => {
        if (p.kind !== 'hermes-target') return true
        hermesProbes += 1
        // Miss the very first Hermes probe (forces one retry), then always hit.
        return hermesProbes !== 1
      },
    })
    const result = await executePlan(androidPlan, runner, { logDir: '/tmp/logs' })
    expect(result.playwrightCode).toBe(0)
    const amStarts = calls.filter(
      (c) => c.type === 'exec' && (c.spec?.args.join(' ').includes('am start') ?? false),
    )
    // launch-1 + one retry (hermes-1 missed once) + launch-2 = 3 am-start execs.
    expect(amStarts.length).toBe(3)
  })

  it('secret-safety: the token reference travels only by file path, never inline (ios + android)', async () => {
    const TOKEN_REF = '<token-file>' // the placeholder standing in for the 0600 token file
    for (const platform of ['ios', 'android'] as const) {
      const { runner, calls } = makeRunner()
      await executePlan(buildDryRunPlan(configFixture(), platform), runner, { logDir: '/tmp/logs' })
      for (const call of calls) {
        const spec = call.spec
        if (!spec) continue
        // The token reference must NEVER be an inline argv element...
        expect(spec.args).not.toContain(TOKEN_REF)
        // ...nor inlined as literal stdin contents (the token goes via stdinFromFile).
        expect(spec.stdinContents ?? '').not.toContain(TOKEN_REF)
        // No env KEY may be a raw `*_TOKEN` (only `*_TOKEN_FILE` path vars allowed).
        for (const key of Object.keys(spec.env ?? {})) expect(key.endsWith('_TOKEN')).toBe(false)
        // Any env VALUE equal to the token ref must be a *_TOKEN_FILE path var.
        for (const [key, value] of Object.entries(spec.env ?? {})) {
          if (value === TOKEN_REF) expect(key.endsWith('_TOKEN_FILE')).toBe(true)
        }
      }
    }
  })
})
