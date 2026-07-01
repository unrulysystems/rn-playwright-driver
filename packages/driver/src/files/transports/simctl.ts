/**
 * iOS **simulator** transport: resolve the app data container to a host path via
 * `xcrun simctl get_app_container`, then read/write it with plain host fs. See
 * `packages/driver/SPEC.md` REQ-XPORT-002.
 */
import { dirname, join, sep } from 'node:path'
import type { FileTransport } from '../device-files'
import { FileIoError } from '../errors'
import type { HostFileExec } from '../host-file-exec'
import type { HostFs } from '../host-fs'
import type { ResolvedRemotePath } from '../roots'
import { errorMessage, mapNodeFsError } from './shared'

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT'
  )
}

/**
 * Confirm `full` resolves — through symlinks — to a location inside the app
 * container before reading/writing it with host privileges. The textual `..`
 * check in `resolveRemotePath` and the `absolute`-root rejection are string-only;
 * an app under test can still plant an in-container symlink (e.g.
 * `Documents/x -> /etc/passwd`) whose target escapes the sandbox. Resolve the
 * longest existing ancestor (a nested push targets a not-yet-created tail) and
 * assert containment; a symlink at any existing component is caught.
 */
async function assertInsideContainer(fs: HostFs, container: string, full: string): Promise<void> {
  const containerReal = await fs.realpath(container)
  let ancestor = full
  for (;;) {
    let real: string
    try {
      real = await fs.realpath(ancestor)
    } catch (error) {
      // Walk up past the not-yet-created tail; any other error is real.
      if (!isEnoent(error)) throw mapNodeFsError(error, full)
      const parent = dirname(ancestor)
      if (parent === ancestor) throw mapNodeFsError(error, full) // hit fs root
      ancestor = parent
      continue
    }
    if (real !== containerReal && !real.startsWith(containerReal + sep)) {
      throw new FileIoError(
        'UNSUPPORTED',
        `device.files: path resolves outside the app container (symlink escape): ${full}`,
      )
    }
    return
  }
}

export interface SimctlTransportConfig {
  readonly udid: string
  readonly bundleId: string
  readonly xcrunPath: string
}

/**
 * Resolve a container-relative path to its host location. `absolute` is rejected:
 * device.files is app-sandbox-scoped, and a raw host path would escape it (this
 * is also blocked upstream — belt and suspenders).
 */
function hostPath(container: string, path: ResolvedRemotePath): string {
  if (path.absolute) {
    throw new FileIoError(
      'UNSUPPORTED',
      "device.files: the 'absolute' root is not supported on iOS (app-sandbox-scoped)",
    )
  }
  return join(container, path.subpath)
}

export function createSimctlTransport(
  config: SimctlTransportConfig,
  exec: HostFileExec,
  fs: HostFs,
): FileTransport {
  // The app data container is stable for the app install, so resolve it once per
  // transport and reuse it across pull/push (only a successful lookup is cached).
  let cachedContainer: string | undefined
  const resolveContainer = async (): Promise<string> => {
    if (cachedContainer !== undefined) return cachedContainer
    // Spawn-level failures (xcrun missing, timeout) reject; map them into the
    // taxonomy so they never escape as raw Node errors (REQ-FILES-007).
    let result: Awaited<ReturnType<HostFileExec>>
    try {
      result = await exec(config.xcrunPath, [
        'simctl',
        'get_app_container',
        config.udid,
        config.bundleId,
        'data',
      ])
    } catch (error) {
      throw new FileIoError(
        'TRANSPORT_FAILED',
        `device.files: simctl get_app_container could not run for ${config.bundleId}: ${errorMessage(error)}`,
      )
    }
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
    cachedContainer = container
    return container
  }

  return {
    async pull(path) {
      const container = await resolveContainer()
      const full = hostPath(container, path)
      await assertInsideContainer(fs, container, full)
      try {
        return await fs.readFile(full)
      } catch (error) {
        throw mapNodeFsError(error, full)
      }
    },
    async push(path, data) {
      const container = await resolveContainer()
      const full = hostPath(container, path)
      await assertInsideContainer(fs, container, full)
      try {
        await fs.writeFile(full, data)
      } catch (error) {
        throw mapNodeFsError(error, full)
      }
    },
  }
}
