/**
 * iOS **physical device** transport (PROVISIONAL — unit-verified; real-hardware
 * E2E pending). Transfers the app-data-container file to/from a host temp file
 * via `xcrun devicectl device copy`. Works only for development-signed apps
 * (`get-task-allow`), which E2E builds are. `--json-output` is the only supported
 * scripted output. See `packages/driver/SPEC.md` REQ-XPORT-003.
 */
import { join } from 'node:path'
import type { FileTransport } from '../device-files'
import { FileIoError } from '../errors'
import type { HostFileExec } from '../host-file-exec'
import type { HostFs } from '../host-fs'
import type { ResolvedRemotePath } from '../roots'
import { classifyCliFailure, errorMessage } from './shared'

export interface DevicectlTransportConfig {
  readonly udid: string
  readonly bundleId: string
  readonly xcrunPath: string
}

export function createDevicectlTransport(
  config: DevicectlTransportConfig,
  exec: HostFileExec,
  fs: HostFs,
): FileTransport {
  // `absolute` is blocked upstream for iOS-device (device-files); guard anyway.
  const containerRelative = (path: ResolvedRemotePath): string => {
    if (path.absolute) {
      throw new FileIoError(
        'UNSUPPORTED',
        "device.files: the 'absolute' root is not supported on a physical iOS device (devicectl is container-scoped)",
      )
    }
    return path.subpath
  }

  const copy = (
    direction: 'from' | 'to',
    source: string,
    destination: string,
    jsonOut: string,
  ): readonly string[] => [
    'devicectl',
    'device',
    'copy',
    direction,
    '--device',
    config.udid,
    '--domain-type',
    'appDataContainer',
    '--domain-identifier',
    config.bundleId,
    '--source',
    source,
    '--destination',
    destination,
    '--json-output',
    jsonOut,
  ]

  // Stage in a host temp dir; a staging failure maps into the taxonomy so it
  // never escapes as a raw Node error (REQ-FILES-007).
  const stageDir = async (): Promise<string> => {
    try {
      return await fs.mkdtempDir('rn-driver-devicectl-')
    } catch (error) {
      throw new FileIoError(
        'TRANSPORT_FAILED',
        `device.files: devicectl could not create a staging dir: ${errorMessage(error)}`,
      )
    }
  }

  const assertOk = async (
    result: Awaited<ReturnType<HostFileExec>>,
    remote: string,
    jsonOut: string,
  ): Promise<void> => {
    if (result.code === 0) return
    // The json-output file carries structured error detail; fall back to stderr.
    let detail = result.stderr
    try {
      detail = `${detail} ${(await fs.readFile(jsonOut)).toString('utf8')}`
    } catch {
      // json-output may be absent on an early failure; stderr is enough.
    }
    throw classifyCliFailure('devicectl', remote, detail, result.code)
  }

  return {
    async pull(path, { maxBuffer }) {
      const remote = containerRelative(path)
      const dir = await stageDir()
      const dest = join(dir, 'payload')
      const jsonOut = join(dir, 'result.json')
      try {
        const result = await exec(config.xcrunPath, copy('from', remote, dest, jsonOut)).catch(
          (error: unknown) => {
            throw new FileIoError(
              'TRANSPORT_FAILED',
              `device.files: devicectl failed: ${errorMessage(error)}`,
            )
          },
        )
        await assertOk(result, remote, jsonOut)
        try {
          // Bound worker memory: the staged payload size is controlled by
          // app/test data; fail closed before buffering it (REQ-FILES-008).
          const size = await fs.size(dest)
          if (size > maxBuffer) {
            throw new FileIoError(
              'TOO_LARGE',
              `device.files: ${remote} is ${size} bytes, exceeds maxBuffer ${maxBuffer}`,
            )
          }
          const bytes = await fs.readFile(dest)
          if (bytes.length > maxBuffer) {
            throw new FileIoError(
              'TOO_LARGE',
              `device.files: ${remote} grew to ${bytes.length} bytes, exceeds maxBuffer ${maxBuffer}`,
            )
          }
          return bytes
        } catch (error) {
          if (error instanceof FileIoError) throw error
          // The `copy from` already succeeded, so a missing/failed STAGED payload
          // is a host-staging failure, never a missing remote file — do not run
          // it through mapNodeFsError (which would mislabel ENOENT as NOT_FOUND).
          throw new FileIoError(
            'TRANSPORT_FAILED',
            `device.files: staged payload unreadable for ${remote}: ${errorMessage(error)}`,
            { cause: error },
          )
        }
      } finally {
        // Best-effort temp cleanup; a cleanup failure must not mask the result.
        await fs.remove(dir).catch(() => {})
      }
    },

    async push(path, data) {
      const remote = containerRelative(path)
      const dir = await stageDir()
      const src = join(dir, 'payload')
      const jsonOut = join(dir, 'result.json')
      try {
        try {
          await fs.writeFile(src, data)
        } catch (error) {
          // A HOST staging-write failure is a transport failure, never a remote
          // NOT_FOUND — mirror the staged-read path (mapNodeFsError would mislabel
          // an ENOENT staging dir as a missing remote file).
          throw new FileIoError(
            'TRANSPORT_FAILED',
            `device.files: could not stage the payload for ${remote}: ${errorMessage(error)}`,
            { cause: error },
          )
        }
        const result = await exec(config.xcrunPath, copy('to', src, remote, jsonOut)).catch(
          (error: unknown) => {
            throw new FileIoError(
              'TRANSPORT_FAILED',
              `device.files: devicectl failed: ${errorMessage(error)}`,
            )
          },
        )
        await assertOk(result, remote, jsonOut)
      } finally {
        // Best-effort temp cleanup; a cleanup failure must not mask the result.
        await fs.remove(dir).catch(() => {})
      }
    },
  }
}
