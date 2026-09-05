import { describe, expect, it } from 'vitest'
import { buildDryRunPlan } from '../build-plan'
import { configFixture, iosDevClientConfigFixture } from '../fixtures'
import type { CommandSpec, ProbeWatch, ProcessRunner, ReadinessProbe } from '../plan/types'
import { executePlan, StageError } from './execute'
import { ProbeFailure } from './probe-failure'

interface Recorded {
  readonly type:
    | 'exec'
    | 'spawn'
    | 'kill'
    | 'write'
    | 'copy'
    | 'rm'
    | 'free'
    | 'install'
    | 'seed'
    | 'probe'
  readonly label: string
  readonly spec?: CommandSpec
  /** The probe's early-abort watch, recorded so tests can assert the executor wired it through. */
  readonly watch?: ProbeWatch | undefined
}

function makeRunner(
  opts: {
    execCode?: (spec: CommandSpec) => number
    spawnError?: (spec: CommandSpec) => Error | null
    writeFileError?: (path: string) => Error | null
    freePortError?: (port: number) => Error | null
    installError?: () => Error | null
    seedError?: (stepEntries: string) => Error | null
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
      const error = opts.spawnError?.(spec)
      if (error) throw error
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
      const error = opts.writeFileError?.(path)
      if (error) return Promise.reject(error)
      return Promise.resolve()
    },
    copyFile(from, to) {
      calls.push({ type: 'copy', label: `${from} -> ${to}` })
      return Promise.resolve()
    },
    removeFile(path) {
      calls.push({ type: 'rm', label: path })
      return Promise.resolve()
    },
    freePort(port) {
      calls.push({ type: 'free', label: String(port) })
      const error = opts.freePortError?.(port)
      if (error) return Promise.reject(error)
      return Promise.resolve()
    },
    installIosApp(spec) {
      calls.push({
        type: 'install',
        label: `${spec.scheme} -> ${spec.target.kind} ${spec.target.udid}`,
      })
      const error = opts.installError?.()
      if (error) return Promise.reject(error)
      return Promise.resolve()
    },
    seedIosDefaults(spec) {
      const label = `${spec.bundleId}: ${spec.entries.map((e) => `${e.key}=${String(e.value)}`).join(' ')}`
      calls.push({ type: 'seed', label })
      const error = opts.seedError?.(label)
      if (error) return Promise.reject(error)
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
const isPlaywrightExec = (c: Recorded) =>
  c.type === 'exec' && c.spec?.command === 'playwright' && c.spec.packageBin === true

describe('executePlan (iOS plan against a mock runner)', () => {
  const plan = buildDryRunPlan(configFixture(), 'ios')

  it('runs the full lifecycle then Playwright, and returns the Playwright exit code', async () => {
    const { runner, calls } = makeRunner({
      execCode: (s) => (s.command === 'playwright' && s.packageBin ? 7 : 0),
    })
    const result = await executePlan(plan, runner, { logDir: '/tmp/logs' })

    expect(result.playwrightCode).toBe(7)
    expect(labels(calls, 'spawn')).toEqual(['metro', 'companion'])
    // Playwright runs after the companion is up.
    const playwrightAt = order(calls, isPlaywrightExec)
    const companionReadyAt = order(calls, (c) => c.type === 'probe' && c.label === 'xctest-hello')
    expect(playwrightAt).toBeGreaterThan(companionReadyAt)
  })

  it('forwards driverEnv into the Playwright process env', async () => {
    const { runner, calls } = makeRunner()
    await executePlan(plan, runner, { logDir: '/tmp/logs' })

    const playwright = calls.find(isPlaywrightExec)
    expect(playwright?.spec?.env).toMatchObject(plan.driverEnv)
  })

  it('lets runner driver env win over project Playwright env conflicts', async () => {
    const conflictingPlan = {
      ...plan,
      playwright: {
        ...plan.playwright,
        env: { RN_METRO_URL: 'http://project-override.invalid', E2E_PROFILE: 'local' },
      },
    }
    const { runner, calls } = makeRunner()
    await executePlan(conflictingPlan, runner, { logDir: '/tmp/logs' })

    const playwright = calls.find(isPlaywrightExec)
    expect(playwright?.spec?.env).toMatchObject({
      E2E_PROFILE: 'local',
      RN_METRO_URL: plan.driverEnv.RN_METRO_URL,
    })
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
    expect(calls.some(isPlaywrightExec)).toBe(false)
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
    expect(calls.some(isPlaywrightExec)).toBe(false)
  })

  it('attributes write-file and free-port failures to their lifecycle stage', async () => {
    const writeFailure = await executePlan(
      plan,
      makeRunner({ writeFileError: () => new Error('EACCES') }).runner,
      { logDir: '/tmp/logs' },
    ).catch((e: unknown) => e)
    expect(writeFailure).toBeInstanceOf(StageError)
    expect(writeFailure).toMatchObject({ stage: 'build', stepId: 'ios.runtime-config' })

    const freePortFailure = await executePlan(
      plan,
      makeRunner({ freePortError: () => new Error('lsof failed') }).runner,
      { logDir: '/tmp/logs' },
    ).catch((e: unknown) => e)
    expect(freePortFailure).toBeInstanceOf(StageError)
    expect(freePortFailure).toMatchObject({ stage: 'companion', stepId: 'ios.free-port' })
  })

  it('seeds the app container through the runner after the install and before the companion, attributing failures to the device stage (REQ-IOS-005, REQ-IOS-016)', async () => {
    const { runner, calls } = makeRunner()
    await executePlan(
      buildDryRunPlan(configFixture({ ios: iosDevClientConfigFixture() }), 'ios'),
      runner,
      { logDir: '/tmp/logs' },
    )
    expect(labels(calls, 'seed')).toEqual([
      'com.unrulyfall.example: RCT_jsLocation=127.0.0.1:8081 RCT_packager_scheme=http',
      'com.unrulyfall.example: EXDevMenuIsOnboardingFinished=true EXDevMenuShowsAtLaunch=false',
    ])
    const firstSeedAt = order(calls, (c) => c.type === 'seed')
    expect(firstSeedAt).toBeGreaterThan(order(calls, (c) => c.type === 'install'))
    expect(firstSeedAt).toBeLessThan(
      order(calls, (c) => c.type === 'spawn' && c.label === 'companion'),
    )

    const failing = makeRunner({
      seedError: (label) => (label.includes('EXDevMenu') ? new Error('not installed') : null),
    })
    const failure = await executePlan(
      buildDryRunPlan(configFixture({ ios: iosDevClientConfigFixture() }), 'ios'),
      failing.runner,
      { logDir: '/tmp/logs' },
    ).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(StageError)
    expect(failure).toMatchObject({ stage: 'device', stepId: 'ios.dev-menu' })
  })

  it('installs the built app through the runner between the build and the companion, attributing failures to the build stage (REQ-IOS-015)', async () => {
    const { runner, calls } = makeRunner()
    await executePlan(plan, runner, { logDir: '/tmp/logs' })
    const installAt = order(calls, (c) => c.type === 'install')
    expect(labels(calls, 'install')).toEqual(['example -> simulator <sim-udid>'])
    expect(installAt).toBeGreaterThan(
      order(calls, (c) => c.type === 'exec' && c.label.includes('xcodebuild build')),
    )
    expect(installAt).toBeLessThan(
      order(calls, (c) => c.type === 'spawn' && c.label === 'companion'),
    )

    const failure = await executePlan(
      plan,
      makeRunner({ installError: () => new Error('the scheme builds no application target') })
        .runner,
      { logDir: '/tmp/logs' },
    ).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(StageError)
    expect(failure).toMatchObject({ stage: 'build', stepId: 'ios.install-app' })
    expect((failure as StageError).message).toContain('no application target')
  })

  it('attributes synchronous background spawn failures to their lifecycle stage', async () => {
    const error = await executePlan(
      plan,
      makeRunner({ spawnError: (spec) => (spec.command === 'sh' ? new Error('ENOENT') : null) })
        .runner,
      { logDir: '/tmp/logs' },
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(StageError)
    expect(error).toMatchObject({ stage: 'metro', stepId: 'metro.start' })
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
    expect(calls.some(isPlaywrightExec)).toBe(true)
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
