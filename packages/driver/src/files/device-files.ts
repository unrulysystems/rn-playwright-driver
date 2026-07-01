/**
 * The `device.files` orchestration: resolve + validate the target, resolve the
 * remote path against its root, enforce root/transport support, then delegate the
 * byte movement to a platform {@link FileTransport} (simctl / devicectl / adb).
 * Transport-agnostic and free of host-process concerns so it unit-tests against a
 * fake transport. See `packages/driver/SPEC.md` REQ-FILES-*.
 */
import { stat } from 'node:fs/promises'
import type { DeviceFiles, FileRoot, TargetContext } from '../types'
import { FileIoError } from './errors'
import { HostFileTooLargeError, readFileBoundedFromDisk } from './host-fs'
import type { ResolvedRemotePath } from './roots'
import { resolveRemotePath } from './roots'
import type { ResolvedFileTarget } from './target'
import { resolveFileTarget } from './target'
import { mapNodeFsError } from './transports/shared'

const DEFAULT_ROOT: FileRoot = 'document'
/** 64 MiB — bounds the read/push size; overflow fails closed (REQ-FILES-008). */
const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024

/**
 * Resolve and validate the byte cap. A non-finite value (`NaN`/`Infinity`) or a
 * non-positive one would make every `size > maxBuffer` check false and silently
 * disable the memory bound, so reject it fail-closed rather than trust it.
 */
function resolveMaxBuffer(maxBuffer: number | undefined): number {
  if (maxBuffer === undefined) return DEFAULT_MAX_BUFFER
  if (!Number.isFinite(maxBuffer) || maxBuffer <= 0) {
    throw new FileIoError(
      'UNSUPPORTED',
      `device.files: maxBuffer must be a positive finite number, got ${maxBuffer}`,
    )
  }
  return maxBuffer
}

/**
 * Moves bytes to/from the app sandbox for one resolved target. Receives an
 * already root-resolved path, so transports carry no root logic. Implemented by
 * the simctl / devicectl / adb transports.
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
  /**
   * Read a host file into a Buffer for push, bounded to `maxBytes` (throws
   * {@link HostFileTooLargeError} past it, without buffering the excess). Defaults
   * to the shared streaming bounded read.
   */
  readonly readLocalFileBounded?: (path: string, maxBytes: number) => Promise<Buffer>
  /** Size (bytes) of a host file, checked before reading it (push guard). Defaults to fs.stat. */
  readonly localFileSize?: (path: string) => Promise<number>
}

export function createDeviceFiles(deps: DeviceFilesDeps): DeviceFiles {
  const readLocalFileBounded = deps.readLocalFileBounded ?? readFileBoundedFromDisk
  const localFileSize = deps.localFileSize ?? (async (path: string) => (await stat(path)).size)

  // The target is fixed for the device, so build the transport once and reuse it
  // across operations — lets stateful transports (e.g. simctl's resolved
  // container) cache per-target work instead of re-spawning a CLI per file.
  let cachedTransport: FileTransport | undefined
  const transportFor = (target: ResolvedFileTarget): FileTransport => {
    cachedTransport ??= deps.selectTransport(target)
    return cachedTransport
  }

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
      const maxBuffer = resolveMaxBuffer(options?.maxBuffer)
      const { target, path } = prepare(remotePath, options?.root ?? DEFAULT_ROOT)
      return transportFor(target).pull(path, { maxBuffer })
    },
    async push(source, remotePath, options) {
      const maxBuffer = resolveMaxBuffer(options?.maxBuffer)
      const { target, path } = prepare(remotePath, options?.root ?? DEFAULT_ROOT)
      // A local-path source is read on the host; map its fs errors into the
      // FileIoError taxonomy so `device.files` never leaks a raw Node error
      // (the public contract promises every failure is a FileIoError).
      let data: Buffer
      if (typeof source === 'string') {
        try {
          // Fast-fail on a known-large source, then a BOUNDED read: symmetric with
          // pull, peak memory stays at maxBuffer even if the file grows between the
          // probe and the read (the probe alone can't promise that — a plain
          // readFile would buffer the grown file first) (REQ-FILES-008).
          const size = await localFileSize(source)
          if (size > maxBuffer) {
            throw new FileIoError(
              'TOO_LARGE',
              `device.files: local source ${source} is ${size} bytes, exceeds maxBuffer ${maxBuffer}`,
            )
          }
          data = await readLocalFileBounded(source, maxBuffer)
        } catch (error) {
          if (error instanceof FileIoError) throw error
          if (error instanceof HostFileTooLargeError) {
            throw new FileIoError(
              'TOO_LARGE',
              `device.files: local source ${source} exceeds maxBuffer ${maxBuffer} (grew past the size probe)`,
            )
          }
          throw mapNodeFsError(error, source)
        }
      } else {
        data = source
      }
      // Re-check the actual byte length: covers a Buffer source (never probed);
      // a string source is already bounded by the read above.
      if (data.length > maxBuffer) {
        throw new FileIoError(
          'TOO_LARGE',
          `device.files: push payload is ${data.length} bytes, exceeds maxBuffer ${maxBuffer}`,
        )
      }
      await transportFor(target).push(path, data)
    },
  }
}

/**
 * The `absolute` root is unsupported on iOS (REQ-XPORT-007). `device.files` is
 * app-sandbox-scoped: on the simulator an absolute path would resolve to a raw
 * HOST path (a sandbox escape with the runner's privileges), and on a device
 * devicectl is container-scoped. Only Android (uid-scoped by `run-as`) supports it.
 */
function assertPathSupported(target: ResolvedFileTarget, path: ResolvedRemotePath): void {
  if (path.absolute && target.platform === 'ios') {
    throw new FileIoError(
      'UNSUPPORTED',
      "device.files: the 'absolute' root is not supported on iOS — device.files is app-sandbox-scoped. Use a named root (document/cache/data).",
    )
  }
}
