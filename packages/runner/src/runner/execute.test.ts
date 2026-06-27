import { describe, expect, it } from 'vitest'
import { buildDryRunPlan } from '../build-plan'
import { configFixture } from '../fixtures'
import type { CommandSpec, ProcessRunner, ReadinessProbe } from '../plan/types'
import { executePlan, StageError } from './execute'

interface Recorded {
  readonly type: 'exec' | 'spawn' | 'kill' | 'write' | 'rm' | 'free' | 'probe'
  readonly label: string
  readonly spec?: CommandSpec
}

function makeRunner(
  opts: {
    execCode?: (spec: CommandSpec) => number
    probeResult?: (probe: ReadinessProbe) => boolean
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
    probe(probe) {
      calls.push({ type: 'probe', label: probe.kind })
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
    await executePlan(plan, runner, {
      logDir: '/tmp/logs',
      skipStep: (step) => step.id === 'metro.start',
      skipCleanup: (action) => action.type === 'kill-process' && action.processKey === 'metro',
    })
    expect(labels(calls, 'spawn')).not.toContain('metro')
    expect(labels(calls, 'kill')).not.toContain('metro')
    // The companion is still managed.
    expect(labels(calls, 'spawn')).toContain('companion')
    expect(labels(calls, 'kill')).toContain('companion')
  })

  it('secret-safety: no executed command carries an inline *_TOKEN env value', async () => {
    const { runner, calls } = makeRunner()
    await executePlan(plan, runner, { logDir: '/tmp/logs' })
    for (const call of calls) {
      const env = call.spec?.env ?? {}
      for (const key of Object.keys(env)) {
        expect(key.endsWith('_TOKEN')).toBe(false)
      }
    }
    // Playwright receives the token FILE path via the merged driver env.
    const playwright = calls.find((c) => c.spec?.args.includes('playwright'))?.spec
    expect(playwright?.env).toMatchObject({ RN_TOUCH_XCTEST_TOKEN_FILE: '<token-file>' })
  })
})
