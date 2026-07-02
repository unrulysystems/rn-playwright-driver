/**
 * Android transport (emulator or physical device — same mechanism): read/write
 * the app-private sandbox via `adb … run-as <pkg>`, which requires a debuggable
 * build. Mirrors the runner's proven token-write pattern (`plan/android.ts`).
 * See `packages/driver/SPEC.md` REQ-XPORT-004.
 *
 * `adb exec-out` neither propagates the remote process exit code (it always
 * exits 0) nor keeps the remote stderr separate (it folds stderr into stdout).
 * A missing file's `cat: … No such file` text would therefore come back as the
 * file's bytes — a silent wrong Buffer, exactly what REQ-FILES-005 forbids. So
 * this transport trusts neither the exit code nor stderr: it signals every
 * outcome on stdout via an explicit sentinel. The read appends cat's own exit
 * code after the bytes in one atomic command (so it fails closed without a
 * probe or a TOCTOU window); the write appends a success sentinel it requires.
 */
import type { FileTransport } from '../device-files'
import { FileIoError } from '../errors'
import {
  type HostFileExec,
  type HostFileExecOptions,
  HostExecMaxBufferError,
} from '../host-file-exec'
import type { ResolvedRemotePath } from '../roots'
import { classifyCliFailure, errorMessage } from './shared'

export interface AdbTransportConfig {
  readonly serial: string
  readonly packageName: string
  readonly adbPath: string
}

// Sentinels emitted on device stdout — the only adb channel that survives
// `exec-out` intact. The design is collision-TOLERANT, not collision-free: it does
// not assume the token is absent from file bytes.
//
// The read appends `<READ_SENTINEL><cat-exit-code>` after the bytes in ONE
// atomic command, so a single `cat` carries its own status: no probe, no
// TOCTOU window, and cat's exit code is recovered even though adb drops it. The
// bytes are recovered by splitting on the LAST sentinel occurrence — always the
// appended one — so file content that happens to contain the token is preserved
// (covered by an adb.test.ts round-trip of bytes containing the sentinel).
const READ_SENTINEL = '__RN_PW_READ__'
const PUSH_OK = '__RN_PW_PUSH_OK__'
// Headroom added to the stdout cap so the sentinel — and a missing/denied file's
// folded `cat:` diagnostic — always fit and get parsed. This keeps NOT_FOUND vs
// TOO_LARGE classification independent of the caller's maxBuffer; the file body
// is then enforced against maxBuffer exactly (REQ-FILES-005/008). A file larger
// than maxBuffer + this headroom still overflows the exec and maps to TOO_LARGE.
const READ_DIAGNOSTIC_HEADROOM = 64 * 1024

// Characters that would break out of the double-quoted path embedded in the
// device-side `sh -c '…'` script (or the single-quoted script wrapper). Reject
// rather than risk a mis-parsed command — fail-closed.
const UNSAFE_PATH = /['"`$\\\n\r]/

export function createAdbTransport(config: AdbTransportConfig, exec: HostFileExec): FileTransport {
  const devicePath = (path: ResolvedRemotePath): string => {
    const remote = path.absolute ? path.path : `/data/data/${config.packageName}/${path.subpath}`
    if (UNSAFE_PATH.test(remote)) {
      throw new FileIoError(
        'UNSUPPORTED',
        `device.files: remote path contains an unsupported shell metacharacter: ${remote}`,
      )
    }
    return remote
  }

  // Run one already-quoted device command through `adb -s <serial> exec-out
  // <command>`; adb forwards it to the device shell verbatim. maxBuffer overflow
  // and spawn failures map to the taxonomy here so callers only handle sentinels.
  const execOut = async (
    command: string,
    options: HostFileExecOptions,
    label: string,
    remote: string,
  ): Promise<Awaited<ReturnType<HostFileExec>>> => {
    try {
      return await exec(config.adbPath, ['-s', config.serial, 'exec-out', command], options)
    } catch (error) {
      if (error instanceof HostExecMaxBufferError) {
        throw new FileIoError(
          'TOO_LARGE',
          `device.files: ${remote} exceeded maxBuffer (${error.maxBuffer} bytes); raise options.maxBuffer to pull it`,
        )
      }
      throw new FileIoError(
        'TRANSPORT_FAILED',
        `device.files: ${label} failed for ${remote}: ${errorMessage(error)}`,
      )
    }
  }

  return {
    async pull(path, { maxBuffer }) {
      const remote = devicePath(path)

      // One atomic read: `cat` the bytes, then append the sentinel + cat's exit
      // code. adb neither propagates the exit code nor keeps stderr out of
      // stdout, so the sentinel is the only way to know whether the bytes are
      // the file or cat's error text (see file header).
      const result = await execOut(
        // `2>&1` folds cat's stderr into stdout IN ORDER, before the sentinel, so
        // a "No such file" diagnostic always lands in `body` (ahead of the last
        // sentinel) and classifies as NOT_FOUND — never dropped by stream
        // interleaving (REQ-FILES-005).
        `run-as ${config.packageName} sh -c 'cat "${remote}" 2>&1; printf "${READ_SENTINEL}%d" $?'`,
        // Headroom so the sentinel + any folded diagnostic always fit and parse;
        // the file body is enforced against maxBuffer exactly below.
        { maxBuffer: maxBuffer + READ_DIAGNOSTIC_HEADROOM },
        'adb run-as cat',
        remote,
      )

      const marker = Buffer.from(READ_SENTINEL, 'utf8')
      const split = result.stdout.lastIndexOf(marker)
      if (split === -1) {
        // No sentinel → the shell never ran (run-as denied, non-debuggable
        // build, unknown package). Its message was folded into stdout/stderr.
        throw classifyCliFailure(
          'adb run-as cat',
          remote,
          `${result.stdout.toString('utf8')}${result.stderr}`,
          result.code,
        )
      }
      const body = result.stdout.subarray(0, split)
      const status = result.stdout
        .subarray(split + marker.length)
        .toString('utf8')
        .trim()
      // The suffix is `printf "…%d" $?`, so a well-formed status is ONLY digits.
      // Require an exact digit match — `Number.parseInt` would accept `0garbage`
      // (it stops at the first non-digit and returns 0), silently treating a
      // corrupted/injected stream as a successful `cat` and returning wrong bytes.
      // Fail closed on anything that is not a clean integer (REQ-FILES-005/007).
      if (!/^\d+$/.test(status)) {
        throw new FileIoError(
          'TRANSPORT_FAILED',
          `device.files: adb run-as cat returned an unparseable status ${JSON.stringify(status)} for ${remote}`,
        )
      }
      const exit = Number.parseInt(status, 10)
      if (exit !== 0) {
        // cat failed → `body` holds its (folded) error text, not file bytes.
        // Classify it and fail closed; never return the diagnostic as a Buffer.
        throw classifyCliFailure(
          'adb run-as cat',
          remote,
          `${body.toString('utf8')}${result.stderr}`,
          exit,
        )
      }
      // Enforce the caller's cap exactly on the file bytes (the read had extra
      // headroom for the sentinel/diagnostic, so classification wasn't skewed).
      if (body.length > maxBuffer) {
        throw new FileIoError(
          'TOO_LARGE',
          `device.files: ${remote} is ${body.length} bytes, exceeding maxBuffer (${maxBuffer}); raise options.maxBuffer to pull it`,
        )
      }
      return body
    },

    async push(path, data) {
      const remote = devicePath(path)
      const dir = posixDirname(remote)
      // One device-shell command so the redirect runs inside the run-as'd app
      // uid (the outer shell uid cannot write the app-private path). mkdir -p is
      // defensive; the trailing sentinel is the success signal because the exit
      // code does not survive adb (see file header).
      const command = `run-as ${config.packageName} sh -c 'mkdir -p "${dir}" && cat > "${remote}" && echo ${PUSH_OK}'`
      let result: Awaited<ReturnType<HostFileExec>>
      try {
        result = await exec(config.adbPath, ['-s', config.serial, 'shell', command], {
          stdin: data,
        })
      } catch (error) {
        throw new FileIoError(
          'TRANSPORT_FAILED',
          `device.files: adb push failed for ${remote}: ${errorMessage(error)}`,
        )
      }
      // Fail closed on an adb-level failure (device gone, adb broke) before
      // trusting stdout: unlike the remote shell's exit code (which does not
      // survive adb), the local adb process code IS meaningful (REQ-FILES-007).
      if (result.code !== 0) {
        throw classifyCliFailure(
          'adb run-as push',
          remote,
          `${result.stdout.toString('utf8')}${result.stderr}`,
          result.code,
        )
      }
      // The sentinel is echoed LAST and only after `cat >` succeeds, so require
      // stdout to END with it. Matching `combined.includes(...)` would let a
      // failure diagnostic that echoes a caller-controlled path containing the
      // token spoof success; end-anchoring on stdout alone closes that.
      const stdout = result.stdout.toString('utf8').trimEnd()
      if (!stdout.endsWith(PUSH_OK)) {
        // No success sentinel → the write did not complete (non-debuggable
        // build, unknown package, unwritable path). Fail closed.
        throw classifyCliFailure(
          'adb run-as push',
          remote,
          `${result.stdout.toString('utf8')}${result.stderr}`,
          result.code,
        )
      }
    },
  }
}

function posixDirname(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx <= 0 ? '/' : path.slice(0, idx)
}
