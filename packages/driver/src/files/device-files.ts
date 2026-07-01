/**
 * The `device.files` orchestration: resolve + validate the target, resolve the
 * remote path against its root, enforce root/transport support, then delegate the
 * byte movement to a platform {@link FileTransport} (simctl / devicectl / adb —
 * M4). Transport-agnostic and free of host-process concerns so it unit-tests
 * against a fake transport. See `packages/driver/SPEC.md` REQ-FILES-*.
 */
import { readFile } from 'node:fs/promises'
import type { DeviceFiles, FileRoot, TargetContext } from '../types'
import { FileIoError } from './errors'
import type { ResolvedRemotePath } from './roots'
import { resolveRemotePath } from './roots'
import type { ResolvedFileTarget } from './target'
import { resolveFileTarget } from './target'
import { mapNodeFsError } from './transports/shared'

const DEFAULT_ROOT: FileRoot = 'document'
/** 64 MiB — bounds the Android stdout stream; overflow fails closed (REQ-FILES-008). */
const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024

/**
 * Moves bytes to/from the app sandbox for one resolved target. Receives an
 * already root-resolved path, so transports carry no root logic. Implemented by
 * the simctl / devicectl / adb transports (M4).
 */
export interface FileTransport {
  pull(path: ResolvedRemotePath, options: { maxBuffer: number }): Promise<Buffer>
  push(path: ResolvedRemotePath, data: Buffer): Promise<void>
}

export type FileTransportFactory = (target: ResolvedFileTarget) => FileTransport

export interface DeviceFilesDeps {
  /** Active platform (from the connected device). */
  readonly platform: 'ios' | 'android'
  /** Raw targeting context (from DeviceOptions.target); validated lazily per op. */
  readonly target: TargetContext | undefined
  /** Builds the platform transport for a resolved target. */
  readonly selectTransport: FileTransportFactory
  /** Reads a host file into a Buffer (push from a local path). Defaults to fs. */
  readonly readLocalFile?: (path: string) => Promise<Buffer>
}

export function createDeviceFiles(deps: DeviceFilesDeps): DeviceFiles {
  const readLocalFile = deps.readLocalFile ?? ((path: string) => readFile(path))

  const prepare = (remotePath: string, root: FileRoot) => {
    // Order matters: validate the target (UNAVAILABLE) before touching the path,
    // so a device with no file targeting fails with the clearer error.
    const target = resolveFileTarget(deps.platform, deps.target)
    const path = resolveRemotePath(deps.platform, root, remotePath)
    assertPathSupported(target, path)
    return { target, path }
  }

  return {
    async pull(remotePath, options) {
      const maxBuffer = options?.maxBuffer ?? DEFAULT_MAX_BUFFER
      const { target, path } = prepare(remotePath, options?.root ?? DEFAULT_ROOT)
      return deps.selectTransport(target).pull(path, { maxBuffer })
    },
    async push(source, remotePath, options) {
      const { target, path } = prepare(remotePath, options?.root ?? DEFAULT_ROOT)
      // A local-path source is read on the host; map its fs errors into the
      // FileIoError taxonomy so `device.files` never leaks a raw Node error
      // (the public contract promises every failure is a FileIoError).
      let data: Buffer
      if (typeof source === 'string') {
        try {
          data = await readLocalFile(source)
        } catch (error) {
          throw mapNodeFsError(error, source)
        }
      } else {
        data = source
      }
      await deps.selectTransport(target).push(path, data)
    },
  }
}

/** The `absolute` root cannot be reached on a physical iOS device (REQ-XPORT-007). */
function assertPathSupported(target: ResolvedFileTarget, path: ResolvedRemotePath): void {
  if (path.absolute && target.platform === 'ios' && target.kind === 'device') {
    throw new FileIoError(
      'UNSUPPORTED',
      "device.files: the 'absolute' root is not supported on a physical iOS device (devicectl is container-scoped)",
    )
  }
}
