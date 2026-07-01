/**
 * iOS **simulator** transport: resolve the app data container to a host path via
 * `xcrun simctl get_app_container`, then read/write it with plain host fs. See
 * `packages/driver/SPEC.md` REQ-XPORT-002.
 */
import { join } from 'node:path'
import type { FileTransport } from '../device-files'
import { FileIoError } from '../errors'
import type { HostFileExec } from '../host-file-exec'
import type { HostFs } from '../host-fs'
import type { ResolvedRemotePath } from '../roots'
import { mapNodeFsError } from './shared'

export interface SimctlTransportConfig {
  readonly udid: string
  readonly bundleId: string
  readonly xcrunPath: string
}

export function createSimctlTransport(
  config: SimctlTransportConfig,
  exec: HostFileExec,
  fs: HostFs,
): FileTransport {
  const resolveContainer = async (): Promise<string> => {
    const result = await exec(config.xcrunPath, [
      'simctl',
      'get_app_container',
      config.udid,
      config.bundleId,
      'data',
    ])
    if (result.code !== 0) {
      throw new FileIoError(
        'TRANSPORT_FAILED',
        `device.files: simctl get_app_container failed for ${config.bundleId}: ${result.stderr.trim() || `exit ${result.code}`}`,
      )
    }
    const container = result.stdout.toString('utf8').trim()
    if (container === '') {
      throw new FileIoError(
        'TRANSPORT_FAILED',
        'device.files: simctl get_app_container returned no path',
      )
    }
    return container
  }

  const hostPath = (container: string, path: ResolvedRemotePath): string =>
    path.absolute ? path.path : join(container, path.subpath)

  return {
    async pull(path) {
      const full = hostPath(await resolveContainer(), path)
      try {
        return await fs.readFile(full)
      } catch (error) {
        throw mapNodeFsError(error, full)
      }
    },
    async push(path, data) {
      const full = hostPath(await resolveContainer(), path)
      try {
        await fs.writeFile(full, data)
      } catch (error) {
        throw mapNodeFsError(error, full)
      }
    },
  }
}
