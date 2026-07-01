/**
 * Injectable host-process seam for the file-I/O transports. The transports
 * (simctl / devicectl / adb) run real host binaries; routing every spawn through
 * this type lets unit tests assert exact argv and drive canned results without
 * spawning anything — the same dependency-injection pattern as `AdbExec` in
 * `src/touch/cli-backend.ts`. See `packages/driver/SPEC.md` REQ-XPORT-006.
 */

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
