/**
 * Injectable host-process seam for the file-I/O transports. The transports
 * (simctl / devicectl / adb) run real host binaries; routing every spawn through
 * this type lets unit tests assert exact argv and drive canned results without
 * spawning anything — the same dependency-injection pattern as `AdbExec` in
 * `src/touch/cli-backend.ts`. See `packages/driver/SPEC.md` REQ-XPORT-006.
 */

import { spawn } from 'node:child_process'

export interface HostExecResult {
  /** Raw stdout bytes (binary-safe — a pulled file streams through here). */
  stdout: Buffer
  /** stderr as text (tool diagnostics). */
  stderr: string
  /** Process exit code (0 on success). */
  code: number
}

export interface HostFileExecOptions {
  /** Bytes to write to the child's stdin (used by the adb push transport). */
  stdin?: Buffer
  /** Kill the child after this many milliseconds. */
  timeoutMs?: number
  /**
   * Maximum stdout bytes to buffer before failing. The caller maps an overflow
   * to {@link FileIoError} `TOO_LARGE`; the exec itself must not truncate.
   */
  maxBuffer?: number
}

/**
 * Run a host binary and resolve its captured output. Implementations must reject
 * (throw) only for spawn-level failures (binary missing, timeout, maxBuffer
 * overflow); a non-zero exit is reported via {@link HostExecResult.code} so the
 * transport can map it to the right {@link FileIoError} code.
 */
export type HostFileExec = (
  command: string,
  args: readonly string[],
  options?: HostFileExecOptions,
) => Promise<HostExecResult>

/** Thrown by the default exec when stdout exceeds `maxBuffer`; mapped to `TOO_LARGE`. */
export class HostExecMaxBufferError extends Error {
  constructor(readonly maxBuffer: number) {
    super(`host command stdout exceeded maxBuffer (${maxBuffer} bytes)`)
    this.name = 'HostExecMaxBufferError'
  }
}

/**
 * Cap on buffered stderr (diagnostics only). Bounds worker memory if a broken or
 * hostile CLI floods stderr; further chunks are dropped, not stored. Independent
 * of `maxBuffer`, which bounds the pulled-file stdout stream.
 */
export const STDERR_CAP = 256 * 1024

/**
 * Default stdout cap when a caller omits `maxBuffer`. Only `pull` streams a large
 * payload and it always passes an explicit `maxBuffer`; the control commands
 * (simctl container lookup, devicectl copy, adb push) emit tiny stdout, so this
 * generous ceiling never truncates a legitimate one while still bounding a
 * broken/hostile CLI that floods stdout with no cap set.
 */
export const DEFAULT_STDOUT_CAP = 16 * 1024 * 1024

/**
 * Default {@link HostFileExec} backed by `child_process.spawn` — captures stdout
 * as a Buffer (binary-safe), writes `options.stdin` to the child, enforces
 * `maxBuffer` by killing the child on overflow, and reports a non-zero exit via
 * `code` rather than throwing (spawn-level failures still reject).
 */
export function createDefaultHostFileExec(): HostFileExec {
  return (command, args, options = {}) =>
    new Promise<HostExecResult>((resolve, reject) => {
      const child = spawn(command, [...args], { stdio: ['pipe', 'pipe', 'pipe'] })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let stdoutLen = 0
      let settled = false
      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        fn()
      }
      const timer =
        options.timeoutMs !== undefined
          ? setTimeout(() => {
              child.kill('SIGKILL')
              finish(() =>
                reject(
                  new Error(`host command timed out after ${options.timeoutMs}ms: ${command}`),
                ),
              )
            }, options.timeoutMs)
          : undefined
      // Always cap stdout: use the caller's maxBuffer when given, else a generous
      // default so a control command that omits it still can't buffer unbounded.
      const stdoutCap = options.maxBuffer ?? DEFAULT_STDOUT_CAP
      child.stdout.on('data', (chunk: Buffer) => {
        stdoutLen += chunk.length
        if (stdoutLen > stdoutCap) {
          child.kill('SIGKILL')
          finish(() => reject(new HostExecMaxBufferError(stdoutCap)))
          return
        }
        stdout.push(chunk)
      })
      let stderrLen = 0
      child.stderr.on('data', (chunk: Buffer) => {
        // Bound stderr memory: keep the first STDERR_CAP bytes (enough to
        // classify a failure), drop the rest so a flood can't OOM the worker.
        // Truncate the chunk that crosses the cap so the bound is exact.
        if (stderrLen >= STDERR_CAP) return
        const room = STDERR_CAP - stderrLen
        const slice = chunk.length > room ? chunk.subarray(0, room) : chunk
        stderrLen += slice.length
        stderr.push(slice)
      })
      child.on('error', (error) => finish(() => reject(error)))
      // A child that exits before consuming the push payload makes the stdin
      // write emit EPIPE. That is benign — the real signal is the exit code from
      // 'close'; swallow ONLY EPIPE so it isn't an unhandled stream error. Any
      // other stdin write failure is real and must surface, not hide behind the
      // later close result.
      child.stdin.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EPIPE') return
        finish(() => reject(error))
      })
      child.on('close', (code) =>
        finish(() =>
          resolve({
            // Accumulate chunks then `concat` — the standard stream-capture pattern
            // (as `child_process.execFile` itself does). A subprocess pipe has no
            // length to pre-size from, and pre-allocating `maxBuffer` (64 MiB for a
            // pull) would waste memory on the common small-file pull; the concat's
            // transient second copy only materializes for a near-cap pull. Hard
            // memory is still bounded: the `maxBuffer` kill above caps stdout and
            // STDERR_CAP caps stderr.
            stdout: Buffer.concat(stdout, stdoutLen),
            stderr: Buffer.concat(stderr).toString('utf8'),
            code: code ?? -1,
          }),
        ),
      )
      child.stdin.end(options.stdin ?? Buffer.alloc(0))
    })
}
