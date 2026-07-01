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
 * outcome on stdout via an explicit sentinel, probing existence/readability
 * before reading bytes and requiring a success sentinel after writing them.
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
// `exec-out` intact. Distinctive enough not to collide with real file bytes.
const PROBE_OK = '__RN_PW_FILE_OK__'
const PROBE_DENIED = '__RN_PW_FILE_DENIED__'
const PROBE_MISSING = '__RN_PW_FILE_MISSING__'
const PUSH_OK = '__RN_PW_PUSH_OK__'

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

      // Probe existence/readability first: the exit code and stderr are useless
      // over exec-out (see file header), so classify on the stdout sentinel.
      const probe = await execOut(
        `run-as ${config.packageName} sh -c 'if [ -r "${remote}" ]; then echo ${PROBE_OK}; elif [ -e "${remote}" ]; then echo ${PROBE_DENIED}; else echo ${PROBE_MISSING}; fi'`,
        {},
        'adb run-as probe',
        remote,
      )
      const probeOut = `${probe.stdout.toString('utf8')}${probe.stderr}`
      if (probeOut.includes(PROBE_MISSING)) {
        throw new FileIoError('NOT_FOUND', `device.files: no such file: ${remote}`)
      }
      if (probeOut.includes(PROBE_DENIED)) {
        throw new FileIoError(
          'TRANSPORT_FAILED',
          `device.files: ${remote} exists but is not readable under run-as`,
        )
      }
      if (!probeOut.includes(PROBE_OK)) {
        // No sentinel at all → run-as itself failed (non-debuggable build,
        // unknown package); its message was folded into stdout.
        throw classifyCliFailure('adb run-as probe', remote, probeOut, probe.code)
      }

      // Confirmed readable → stream the bytes. exec-out keeps stdout binary-clean.
      const result = await execOut(
        `run-as ${config.packageName} sh -c 'cat "${remote}"'`,
        { maxBuffer },
        'adb run-as cat',
        remote,
      )
      return result.stdout
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
      const combined = `${result.stdout.toString('utf8')}${result.stderr}`
      if (!combined.includes(PUSH_OK)) {
        // No success sentinel → the write did not complete (non-debuggable
        // build, unknown package, unwritable path). Fail closed.
        throw classifyCliFailure('adb run-as push', remote, combined, result.code)
      }
    },
  }
}

function posixDirname(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx <= 0 ? '/' : path.slice(0, idx)
}
