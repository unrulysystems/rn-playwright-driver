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
    readFileBounded: async (path, maxBytes) => {
      // Allocate at most maxBytes+1 and stop reading once full: peak memory is
      // bounded regardless of the on-disk size, so a file that grew after a probe
      // (or is being concurrently written) can never exhaust the worker.
      const cap = maxBytes + 1
      const buf = Buffer.alloc(cap)
      const handle = await open(path, 'r')
      try {
        let total = 0
        while (total < cap) {
          const { bytesRead } = await handle.read(buf, total, cap - total, total)
          if (bytesRead === 0) break // EOF
          total += bytesRead
        }
        if (total > maxBytes) throw new HostFileTooLargeError(maxBytes)
        return buf.subarray(0, total)
      } finally {
        await handle.close()
      }
    },
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
