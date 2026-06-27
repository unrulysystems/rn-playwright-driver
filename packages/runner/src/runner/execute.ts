import type { Stage } from '../plan/types'
import type {
  CleanupAction,
  Plan,
  ProcessRunner,
  ReadinessProbe,
  SpawnHandle,
  Step,
} from '../plan/types'

export class StageError extends Error {
  readonly stage: Stage
  readonly stepId: string
  constructor(stage: Stage, stepId: string, message: string) {
    super(`[${stage}] ${stepId}: ${message}`)
    this.name = 'StageError'
    this.stage = stage
    this.stepId = stepId
  }
}

export interface ExecuteOptions {
  /** Reuse an already-built native project: skip steps marked `skippable`. */
  readonly skipBuild?: boolean
  /** Per-run log directory for background-process output. */
  readonly logDir: string
  /** Stream per-step progress (`--verbose`). Stage failures are always logged. */
  readonly verbose?: boolean
  /** Skip a step entirely (e.g. don't start Metro when reusing a running one). */
  readonly skipStep?: (step: Step) => boolean | Promise<boolean>
  /** Skip a cleanup action (e.g. don't kill a Metro the runner did not start). */
  readonly skipCleanup?: (action: CleanupAction) => boolean
}

export interface ExecuteResult {
  readonly playwrightCode: number
}

/**
 * Effectful interpreter of a {@link Plan}. Runs steps in order, gating on
 * readiness probes, then invokes Playwright. Cleanup runs on every exit path and
 * is defensive/idempotent (REQ-CLEAN-001). A lifecycle failure is raised as a
 * {@link StageError} naming the stage that broke (REQ-DIAG-001).
 */
export async function executePlan(
  plan: Plan,
  runner: ProcessRunner,
  opts: ExecuteOptions,
): Promise<ExecuteResult> {
  const processes = new Map<string, SpawnHandle>()
  const isAlive = (key: string): boolean => {
    const handle = processes.get(key)
    // No handle means the backing process was intentionally skipped (e.g. a
    // reused external Metro whose `metro.start` step was skipped) — treat it as
    // alive so the probe polls the URL to its timeout instead of failing
    // instantly. Fail-fast applies only to a process the runner started that has
    // since died (handle present and dead).
    return handle ? runner.isAlive(handle) : true
  }

  try {
    for (const step of plan.steps) {
      if (opts.skipBuild && step.skippable) {
        if (opts.verbose) runner.log(`skip (skip-build): ${step.id}`)
        continue
      }
      if (opts.skipStep && (await opts.skipStep(step))) {
        if (opts.verbose) runner.log(`skip: ${step.id}`)
        continue
      }
      await runStep(step, runner, opts, processes, isAlive)
    }

    runner.log(`Running Playwright: ${plan.playwright.command} ${plan.playwright.args.join(' ')}`)
    const result = await runner.exec({
      ...plan.playwright,
      env: { ...plan.playwright.env, ...plan.driverEnv },
    })
    return { playwrightCode: result.code }
  } finally {
    await runCleanup(plan.cleanup, runner, opts, processes)
  }
}

async function runStep(
  step: Step,
  runner: ProcessRunner,
  opts: ExecuteOptions,
  processes: Map<string, SpawnHandle>,
  isAlive: (key: string) => boolean,
): Promise<void> {
  if (opts.verbose) runner.log(`→ ${step.id}: ${step.description}`)
  const action = step.action

  switch (action.type) {
    case 'command': {
      if (action.background) {
        const key = action.processKey ?? step.id
        const handle = runner.spawn(action.command, { key, logPath: logPathFor(opts.logDir, key) })
        processes.set(key, handle)
        return
      }
      const result = await runner.exec(action.command)
      if (result.code !== 0 && !action.allowFailure) {
        throw new StageError(step.stage, step.id, `command exited ${result.code}`)
      }
      return
    }
    case 'write-file': {
      await runner.writeFile(action.path, action.contents, action.mode)
      return
    }
    case 'free-port': {
      await runner.freePort(action.port)
      return
    }
    case 'probe': {
      const key = processKeyForProbe(action.probe)
      const aliveFn = key === null ? () => true : () => isAlive(key)
      let ready = await runner.probe(action.probe, aliveFn)
      // Bounded retry (REQ-AND-005): re-run the retry command (e.g. re-issue
      // `am start`) and probe again, up to `max` extra attempts.
      let remaining = action.retry?.max ?? 0
      while (!ready && remaining > 0) {
        remaining -= 1
        if (action.retry) {
          runner.log(`retry ${step.id}: re-running launch (${remaining} attempt(s) left)`)
          await runner.exec(action.retry.command)
        }
        ready = await runner.probe(action.probe, aliveFn)
      }
      if (!ready) {
        throw new StageError(
          step.stage,
          step.id,
          `readiness timed out after ${action.probe.timeoutMs}ms`,
        )
      }
      return
    }
    default: {
      const _exhaustive: never = action
      throw new Error(`unhandled action: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

async function runCleanup(
  actions: readonly CleanupAction[],
  runner: ProcessRunner,
  opts: ExecuteOptions,
  processes: Map<string, SpawnHandle>,
): Promise<void> {
  for (const action of actions) {
    if (opts.skipCleanup && opts.skipCleanup(action)) continue
    try {
      switch (action.type) {
        case 'kill-process': {
          const handle = processes.get(action.processKey)
          if (handle) await runner.kill(handle)
          break
        }
        case 'free-port':
          await runner.freePort(action.port)
          break
        case 'remove-file':
          await runner.removeFile(action.path)
          break
        case 'command':
          await runner.exec(action.command)
          break
        default: {
          const _exhaustive: never = action
          throw new Error(`unhandled cleanup: ${JSON.stringify(_exhaustive)}`)
        }
      }
    } catch (error) {
      // Cleanup is best-effort; a teardown failure must not mask the run result.
      runner.log(`cleanup ${action.description} failed: ${String(error)}`)
    }
  }
}

/**
 * Which background process a readiness probe depends on, for fail-fast when that
 * process dies before becoming ready. `null` means no process dependency (the
 * Hermes target is the app, not a runner-tracked process).
 */
function processKeyForProbe(probe: ReadinessProbe): 'metro' | 'companion' | null {
  switch (probe.kind) {
    case 'metro-status':
      return 'metro'
    case 'xctest-hello':
    case 'instrumentation-hello':
      return 'companion'
    case 'hermes-target':
      return null
    default: {
      const _exhaustive: never = probe
      throw new Error(`unhandled probe: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

function logPathFor(logDir: string, key: string): string {
  return `${logDir}/${key}.log`
}
