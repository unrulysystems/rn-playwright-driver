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

/** Chunk size for the streaming bounded read; small enough that a tiny file costs a tiny buffer. */
const BOUNDED_READ_CHUNK = 64 * 1024

/**
 * Read at most `maxBytes` from `path`, throwing {@link HostFileTooLargeError} if
 * the file is larger — WITHOUT ever buffering the excess. Reads one byte past the
 * cap purely to detect overflow, and allocates in {@link BOUNDED_READ_CHUNK}
 * chunks so a tiny file costs a tiny buffer (not the full cap). Shared by the iOS
 * pull transports and `device.files` push, so both enforce the same memory bound
 * even when the file grows between a size probe and the read (REQ-FILES-008).
 */
export async function readFileBoundedFromDisk(path: string, maxBytes: number): Promise<Buffer> {
  const overflowCap = maxBytes + 1 // one byte past the cap is enough to know it's too large
  const handle = await open(path, 'r')
  try {
    const chunks: Buffer[] = []
    let total = 0
    while (total < overflowCap) {
      const want = Math.min(BOUNDED_READ_CHUNK, overflowCap - total)
      const chunk = Buffer.allocUnsafe(want)
      const { bytesRead } = await handle.read(chunk, 0, want, total)
      if (bytesRead === 0) break // EOF
      // Only ever expose the bytes actually read — allocUnsafe leaves the tail uninitialized.
      chunks.push(bytesRead === want ? chunk : chunk.subarray(0, bytesRead))
      total += bytesRead
    }
    if (total > maxBytes) throw new HostFileTooLargeError(maxBytes)
    return Buffer.concat(chunks, total)
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
