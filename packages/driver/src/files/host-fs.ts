/**
 * Injectable host-filesystem seam for the iOS transports (simctl reads/writes the
 * simulator container directly; devicectl stages through a host temp dir). Kept
 * behind an interface so transport tests never touch the real disk.
 */
import { mkdir, mkdtemp, open, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Thrown by {@link HostFs.readFileBounded} when the file exceeds the cap. A
 * distinct type so transports map it to `TOO_LARGE` without string-matching, and
 * so the seam stays free of the `FileIoError` taxonomy.
 */
export class HostFileTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`file exceeds ${maxBytes} bytes`)
    this.name = 'HostFileTooLargeError'
  }
}

/**
 * Read at most `maxBytes` from `path`, throwing {@link HostFileTooLargeError} if
 * the file is larger — WITHOUT ever buffering the excess. Reads into ONE buffer
 * (no chunk list + `concat`, so no ~2x transient) sized to the file, so:
 *   - a small file costs a small buffer (not the full 64 MiB cap),
 *   - a stable read peaks at ~filesize+1 ≤ maxBytes+1 (honors REQ-FILES-008),
 *   - a file that GREW past the initial size hint mid-read triggers a single
 *     reallocation up to the hard cap and still rejects past it.
 * Shared by the iOS pull transports and `device.files` push, so both enforce the
 * same bound even when the file changes size between a size probe and the read.
 */
export async function readFileBoundedFromDisk(path: string, maxBytes: number): Promise<Buffer> {
  const overflowCap = maxBytes + 1 // read one byte past the cap to detect "too large"
  const handle = await open(path, 'r')
  try {
    // Size the buffer to the file (capped): the common case allocates ~filesize,
    // never the full cap. `+ 1` lets a read that exactly fills it prove EOF.
    const hint = Math.min((await handle.stat()).size, maxBytes) + 1
    let buf = Buffer.allocUnsafe(hint)
    let total = 0
    for (;;) {
      // The file grew past our hint but is still under the cap — grow once to the
      // hard cap and copy forward (rare: only a concurrent/racing writer).
      if (total === buf.length && buf.length < overflowCap) {
        const grown = Buffer.allocUnsafe(overflowCap)
        buf.copy(grown, 0, 0, total)
        buf = grown
      }
      if (total >= overflowCap) break // already one past the cap → too large
      const { bytesRead } = await handle.read(buf, total, buf.length - total, total)
      if (bytesRead === 0) break // EOF
      total += bytesRead
    }
    if (total > maxBytes) throw new HostFileTooLargeError(maxBytes)
    // Only ever expose the bytes actually read — allocUnsafe leaves the tail
    // uninitialized, and the hint may over-allocate by up to one byte.
    return buf.subarray(0, total)
  } finally {
    await handle.close()
  }
}

export interface HostFs {
  readFile(path: string): Promise<Buffer>
  /**
   * Read at most `maxBytes` into memory, throwing {@link HostFileTooLargeError} if
   * the file is larger — WITHOUT buffering the excess. Unlike `size` + `readFile`,
   * this actually bounds peak worker memory even if the file grows between a size
   * probe and the read (REQ-FILES-008).
   */
  readFileBounded(path: string, maxBytes: number): Promise<Buffer>
  /** Write `data`, creating parent directories as needed. */
  writeFile(path: string, data: Buffer): Promise<void>
  /** Create a unique temp directory and return its absolute path. */
  mkdtempDir(prefix: string): Promise<string>
  /** Remove a file or directory recursively; missing paths are ignored. */
  remove(path: string): Promise<void>
  /** Resolve a path through symlinks to its canonical location (for containment checks). */
  realpath(path: string): Promise<string>
  /** Size of a file in bytes (a cheap fast-fail before {@link readFileBounded}). */
  size(path: string): Promise<number>
}

export function createDefaultHostFs(): HostFs {
  return {
    readFile: (path) => readFile(path),
    readFileBounded: (path, maxBytes) => readFileBoundedFromDisk(path, maxBytes),
    writeFile: async (path, data) => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, data)
    },
    mkdtempDir: (prefix) => mkdtemp(join(tmpdir(), prefix)),
    remove: (path) => rm(path, { recursive: true, force: true }),
    realpath: (path) => realpath(path),
    size: async (path) => (await stat(path)).size,
  }
}
