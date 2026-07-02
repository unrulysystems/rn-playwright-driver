/**
 * iOS **simulator** transport: resolve the app data container to a host path via
 * `xcrun simctl get_app_container`, then read/write it with plain host fs. See
 * `packages/driver/SPEC.md` REQ-XPORT-002.
 */
import { basename, dirname, join, sep } from 'node:path'
import type { FileTransport } from '../device-files'
import { FileIoError } from '../errors'
import type { HostFileExec } from '../host-file-exec'
import { type HostFs, HostFileTooLargeError } from '../host-fs'
import type { ResolvedRemotePath } from '../roots'
import { errorMessage, mapNodeFsError } from './shared'

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT'
  )
}

/**
 * Resolve `full` to the canonical, symlink-free path to operate on, confirming
 * it stays inside the app container. The textual `..` check in
 * `resolveRemotePath` and the `absolute`-root rejection are string-only; an app
 * under test can plant an in-container symlink (e.g. `Documents/x -> /etc/passwd`)
 * whose target escapes the sandbox. This resolves the longest existing ancestor
 * (a nested push targets a not-yet-created tail), asserts containment, and
 * REBUILDS the path under that canonical ancestor — so the subsequent read/write
 * never re-follows a symlinked component. The residual is a narrow TOCTOU: a
 * cooperative app-under-test is assumed (see SPEC REQ-XPORT-002); this is not a
 * security boundary against an app deliberately racing the runner.
 */
async function resolveInsideContainer(
  fs: HostFs,
  container: string,
  full: string,
): Promise<string> {
  let containerReal: string
  try {
    containerReal = await fs.realpath(container)
  } catch (error) {
    // A container that vanished after get_app_container succeeded is a TRANSPORT
    // failure — not a missing remote file. Mapping ENOENT via mapNodeFsError
    // would mislabel it NOT_FOUND (REQ-FILES-007).
    throw new FileIoError(
      'TRANSPORT_FAILED',
      `device.files: the app container is no longer resolvable (${container}): ${errorMessage(error)}`,
      { cause: error },
    )
  }
  let ancestor = full
  const tail: string[] = []
  for (;;) {
    let real: string
    try {
      real = await fs.realpath(ancestor)
    } catch (error) {
      // Walk up past the not-yet-created tail; any other error is real.
      if (!isEnoent(error)) throw mapNodeFsError(error, full)
      const parent = dirname(ancestor)
      if (parent === ancestor) throw mapNodeFsError(error, full) // hit fs root
      tail.unshift(basename(ancestor))
      ancestor = parent
      continue
    }
    if (real !== containerReal && !real.startsWith(containerReal + sep)) {
      throw new FileIoError(
        'UNSUPPORTED',
        `device.files: path resolves outside the app container (symlink escape): ${full}`,
      )
    }
    // Operate under the canonical prefix, bypassing any symlinked ancestor.
    return tail.length > 0 ? join(real, ...tail) : real
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
    async pull(path, { maxBuffer }) {
      const container = await resolveContainer()
      const safe = await resolveInsideContainer(fs, container, hostPath(container, path))
      try {
        // Fast-fail on a known-large file, then a BOUNDED read: even if the app
        // grows/swaps the container file between the probe and the read, peak
        // worker memory stays at maxBuffer+1 — the size probe alone can't promise
        // that (readFile would buffer the grown file first) (REQ-FILES-008).
        const size = await fs.size(safe)
        if (size > maxBuffer) {
          throw new FileIoError(
            'TOO_LARGE',
            `device.files: ${safe} is ${size} bytes, exceeds maxBuffer ${maxBuffer}`,
          )
        }
        return await fs.readFileBounded(safe, maxBuffer)
      } catch (error) {
        if (error instanceof FileIoError) throw error
        if (error instanceof HostFileTooLargeError) {
          throw new FileIoError(
            'TOO_LARGE',
            `device.files: ${safe} exceeds maxBuffer ${maxBuffer} (grew past the size probe)`,
          )
        }
        throw mapNodeFsError(error, safe)
      }
    },
    async push(path, data) {
      const container = await resolveContainer()
      const safe = await resolveInsideContainer(fs, container, hostPath(container, path))
      try {
        await fs.writeFile(safe, data)
      } catch (error) {
        throw mapNodeFsError(error, safe)
      }
    },
  }
}
