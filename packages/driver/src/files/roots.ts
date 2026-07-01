/**
 * Pure resolution of a remote path against a named {@link FileRoot}. Produces
 * either a verbatim absolute path (`absolute` root) or a container-relative posix
 * subpath the transport prepends its container/home to. Enforces the no-escape
 * rule (REQ-FILES-004): a leading `/` is treated as root-relative, and `..`
 * traversal out of the root is rejected. See `packages/driver/SPEC.md`.
 */
import type { FileRoot } from '../types'
import { FileIoError } from './errors'

/**
 * Per-platform subdirectory each named root maps to, relative to the app
 * container root (iOS `<data>`) / app home (Android `/data/data/<pkg>`).
 * `document`/`cache` mirror `expo-file-system`'s `documentDirectory`/
 * `cacheDirectory`; `data` is the container/home root itself.
 */
const ROOT_DIRS: Record<'ios' | 'android', Record<Exclude<FileRoot, 'absolute'>, string>> = {
  ios: { document: 'Documents', cache: 'Library/Caches', data: '' },
  android: { document: 'files', cache: 'cache', data: '' },
}

/** A resolved remote location: verbatim absolute, or a container-relative subpath. */
export type ResolvedRemotePath =
  | { readonly absolute: true; readonly path: string }
  | { readonly absolute: false; readonly subpath: string }

export function resolveRemotePath(
  platform: 'ios' | 'android',
  root: FileRoot,
  remotePath: string,
): ResolvedRemotePath {
  if (root === 'absolute') {
    if (remotePath.trim() === '') {
      throw new FileIoError(
        'UNSUPPORTED',
        "device.files: the 'absolute' root requires a non-empty path",
      )
    }
    // Require a genuinely absolute device path. A relative value would resolve
    // against the `run-as` shell cwd (adb), silently reading/writing the wrong
    // location instead of the requested path — fail closed (REQ-XPORT-004).
    if (!remotePath.startsWith('/')) {
      throw new FileIoError(
        'UNSUPPORTED',
        `device.files: the 'absolute' root requires a path starting with '/': ${JSON.stringify(remotePath)}`,
      )
    }
    return { absolute: true, path: remotePath }
  }

  const normalized = normalizeUnderRoot(remotePath)
  const rootDir = ROOT_DIRS[platform][root]
  return { absolute: false, subpath: rootDir === '' ? normalized : `${rootDir}/${normalized}` }
}

/**
 * Normalize a path so it stays under its root: drop a leading `/` (root-relative,
 * never an escape), collapse redundant/`.` segments, and reject any `..` segment.
 */
function normalizeUnderRoot(remotePath: string): string {
  const trimmed = remotePath.replace(/^\/+/, '')
  const segments = trimmed.split('/').filter((segment) => segment !== '' && segment !== '.')
  if (segments.length === 0) {
    throw new FileIoError('UNSUPPORTED', 'device.files: remote path is empty')
  }
  if (segments.includes('..')) {
    throw new FileIoError(
      'UNSUPPORTED',
      `device.files: remote path must not escape the root: ${JSON.stringify(remotePath)}`,
    )
  }
  return segments.join('/')
}
