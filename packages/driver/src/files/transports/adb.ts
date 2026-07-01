/**
 * Android transport (emulator or physical device — same mechanism): read/write
 * the app-private sandbox via `adb … run-as <pkg>`, which requires a debuggable
 * build. Mirrors the runner's proven token-write pattern (`plan/android.ts`).
 * See `packages/driver/SPEC.md` REQ-XPORT-004.
 */
import type { FileTransport } from '../device-files'
import { FileIoError } from '../errors'
import { type HostFileExec, HostExecMaxBufferError } from '../host-file-exec'
import type { ResolvedRemotePath } from '../roots'
import { classifyCliFailure, errorMessage } from './shared'

export interface AdbTransportConfig {
  readonly serial: string
  readonly packageName: string
  readonly adbPath: string
}

export function createAdbTransport(config: AdbTransportConfig, exec: HostFileExec): FileTransport {
  const devicePath = (path: ResolvedRemotePath): string => {
    const remote = path.absolute ? path.path : `/data/data/${config.packageName}/${path.subpath}`
    // The path is embedded in a single-quoted device-side `sh -c '…'` script; a
    // single quote in the path would break out of it. Reject rather than risk a
    // mis-parsed command (fail-closed).
    if (remote.includes("'")) {
      throw new FileIoError(
        'UNSUPPORTED',
        `device.files: remote path may not contain a single quote: ${remote}`,
      )
    }
    return remote
  }

  return {
    async pull(path, { maxBuffer }) {
      const remote = devicePath(path)
      let result: Awaited<ReturnType<HostFileExec>>
      try {
        result = await exec(
          config.adbPath,
          ['-s', config.serial, 'exec-out', 'run-as', config.packageName, 'cat', remote],
          { maxBuffer },
        )
      } catch (error) {
        if (error instanceof HostExecMaxBufferError) {
          throw new FileIoError(
            'TOO_LARGE',
            `device.files: ${remote} exceeded maxBuffer (${error.maxBuffer} bytes); raise options.maxBuffer to pull it`,
          )
        }
        throw new FileIoError(
          'TRANSPORT_FAILED',
          `device.files: adb pull failed for ${remote}: ${errorMessage(error)}`,
        )
      }
      if (result.code !== 0) {
        throw classifyCliFailure('adb run-as cat', remote, result.stderr, result.code)
      }
      return result.stdout
    },

    async push(path, data) {
      const remote = devicePath(path)
      const dir = posixDirname(remote)
      // Single device-shell arg so the redirect runs inside the run-as'd app uid
      // (the outer shell uid cannot write the app-private path). mkdir -p is
      // defensive: the target dir may not exist yet.
      const script = `run-as ${config.packageName} sh -c 'mkdir -p ${dir} && cat > ${remote}'`
      let result: Awaited<ReturnType<HostFileExec>>
      try {
        result = await exec(config.adbPath, ['-s', config.serial, 'shell', script], { stdin: data })
      } catch (error) {
        throw new FileIoError(
          'TRANSPORT_FAILED',
          `device.files: adb push failed for ${remote}: ${errorMessage(error)}`,
        )
      }
      const combined = `${result.stdout.toString('utf8')}${result.stderr}`
      if (result.code !== 0 || /run-as:|no such file|permission denied/i.test(combined)) {
        throw classifyCliFailure('adb run-as push', remote, combined, result.code)
      }
    },
  }
}

function posixDirname(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx <= 0 ? '/' : path.slice(0, idx)
}
