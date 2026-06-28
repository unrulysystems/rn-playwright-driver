import type { Platform } from '../config'

/**
 * A single OS command. `args` and `env` MUST NEVER contain a secret value — a
 * token reaches a process only via a file path (`stdinFromFile`, or a path in
 * `args`/`env`), never as a literal.
 */
export interface CommandSpec {
  readonly command: string
  readonly args: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
  /** Pipe this file's bytes to stdin (keeps secret values out of argv). */
  readonly stdinFromFile?: string
  /** Pipe this literal (non-secret) content to stdin (e.g. generated config XML). */
  readonly stdinContents?: string
}

/**
 * A poll-until-ready check with a bounded timeout. The executor polls; a probe
 * that does not pass within `timeoutMs` is a stage failure.
 */
export type ReadinessProbe =
  | { readonly kind: 'metro-status'; readonly metroUrl: string; readonly timeoutMs: number }
  | {
      readonly kind: 'hermes-target'
      readonly platform: Platform
      readonly metroUrl: string
      readonly appId: string
      readonly deviceNameMatch?: string
      readonly timeoutMs: number
    }
  | {
      readonly kind: 'xctest-hello'
      readonly port: number
      readonly tokenFile: string
      readonly timeoutMs: number
    }
  | {
      readonly kind: 'instrumentation-hello'
      readonly port: number
      readonly tokenFile: string
      readonly timeoutMs: number
    }

export type StepAction =
  | {
      readonly type: 'command'
      readonly command: CommandSpec
      /** Long-lived process (Metro, companion). Tracked by `processKey` for cleanup. */
      readonly background?: boolean
      readonly processKey?: string
      /** Best-effort command: a non-zero exit does not fail the run (bash `|| true`). */
      readonly allowFailure?: boolean
    }
  | {
      readonly type: 'write-file'
      readonly path: string
      readonly contents: string
      readonly mode?: number
    }
  | { readonly type: 'free-port'; readonly port: number }
  | {
      readonly type: 'probe'
      readonly probe: ReadinessProbe
      /**
       * Bounded retry: if the probe times out, re-run `command` and probe again,
       * up to `max` extra attempts (REQ-AND-005 — re-issue `am start` when the
       * app loses a transient Hermes-registration race instead of failing).
       */
      readonly retry?: { readonly command: CommandSpec; readonly max: number }
      /**
       * Terminal failure substrings to watch for in the backing process's captured log. If one
       * appears, the readiness wait aborts EARLY (the build/test failed and will never become
       * ready) instead of burning the full timeout. Set by the planner on the companion-ready step
       * (see COMPANION_FAILURE_MARKERS); the executor pairs them with the process's log path.
       */
      readonly failureMarkers?: readonly string[]
    }

/** The lifecycle stage a step belongs to. A failure is attributed to its stage. */
export type Stage =
  | 'config'
  | 'metro'
  | 'device'
  | 'build'
  | 'companion'
  | 'app-launch'
  | 'hermes-target'
  | 'playwright'
  | 'cleanup'

export interface Step {
  readonly id: string
  readonly stage: Stage
  readonly description: string
  readonly action: StepAction
  /** Skipped when `--skip-build` reuses an already-built native project. */
  readonly skippable?: boolean
}

/**
 * Teardown is emitted declaratively by the planner (so `--dry-run` shows it) and
 * run defensively by the executor (so it is idempotent — REQ-CLEAN-001). Each
 * action is a no-op when its precondition does not hold.
 */
export type CleanupAction =
  | { readonly type: 'kill-process'; readonly processKey: string; readonly description: string }
  | { readonly type: 'free-port'; readonly port: number; readonly description: string }
  | { readonly type: 'remove-file'; readonly path: string; readonly description: string }
  | { readonly type: 'command'; readonly command: CommandSpec; readonly description: string }

export interface Plan {
  readonly platform: Platform
  readonly steps: readonly Step[]
  readonly cleanup: readonly CleanupAction[]
  /** The driver env contract handed to Playwright — token files only, no values. */
  readonly driverEnv: Readonly<Record<string, string>>
  /** The Playwright invocation run after the world is up. */
  readonly playwright: CommandSpec
}

export interface ExecResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export interface SpawnHandle {
  readonly key: string
  readonly pid: number | undefined
}

/**
 * Early-abort watch for a readiness probe: the captured log of the probe's backing process plus the
 * terminal failure substrings to scan it for. When a marker appears, the probe throws and the run
 * fails fast with the real build/test error instead of an opaque readiness timeout.
 */
export interface ProbeWatch {
  readonly logPath: string
  readonly failureMarkers: readonly string[]
}

/**
 * The single OS boundary. The pure planners never touch this; the executor uses
 * it to interpret a {@link Plan}. Tests inject a mock to assert order, readiness
 * gating, cleanup, and secret-safety without real devices.
 */
export interface ProcessRunner {
  /** Run to completion and resolve with the exit code (rejects only if the
   * process cannot be spawned). The caller decides what a non-zero code means. */
  exec(spec: CommandSpec, opts?: { logPath?: string }): Promise<ExecResult>
  /** Start a long-lived background process; output is captured to `logPath`. */
  spawn(spec: CommandSpec, opts: { key: string; logPath: string }): SpawnHandle
  /** Whether a previously-spawned process is still alive. */
  isAlive(handle: SpawnHandle): boolean
  /** Terminate a spawned process (idempotent). */
  kill(handle: SpawnHandle): Promise<void>
  /** Write a file, optionally with a restrictive mode (used for 0600 configs). */
  writeFile(path: string, contents: string, mode?: number): Promise<void>
  /** Remove a file (idempotent). */
  removeFile(path: string): Promise<void>
  /** Free a TCP listener bound to `port` (lsof + kill). Idempotent. */
  freePort(port: number): Promise<void>
  /**
   * Poll a readiness probe; resolves true when ready, false on timeout. When `watch` is given, the
   * probe also scans the backing process's log each poll and THROWS {@link ProbeFailure} the moment
   * a terminal failure marker appears (build/test failed) — so a doomed companion fails fast instead
   * of waiting out the cold-build timeout.
   */
  probe(probe: ReadinessProbe, isAlive: () => boolean, watch?: ProbeWatch): Promise<boolean>
  /** Structured log sink. Never receives secret values. */
  log(line: string): void
}
