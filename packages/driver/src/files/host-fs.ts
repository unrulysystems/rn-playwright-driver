/**
 * Injectable host-filesystem seam for the iOS transports (simctl reads/writes the
 * simulator container directly; devicectl stages through a host temp dir). Kept
 * behind an interface so transport tests never touch the real disk.
 */
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export interface HostFs {
  readFile(path: string): Promise<Buffer>
  /** Write `data`, creating parent directories as needed. */
  writeFile(path: string, data: Buffer): Promise<void>
  /** Create a unique temp directory and return its absolute path. */
  mkdtempDir(prefix: string): Promise<string>
  /** Remove a file or directory recursively; missing paths are ignored. */
  remove(path: string): Promise<void>
  /** Resolve a path through symlinks to its canonical location (for containment checks). */
  realpath(path: string): Promise<string>
}

export function createDefaultHostFs(): HostFs {
  return {
    readFile: (path) => readFile(path),
    writeFile: async (path, data) => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, data)
    },
    mkdtempDir: (prefix) => mkdtemp(join(tmpdir(), prefix)),
    remove: (path) => rm(path, { recursive: true, force: true }),
    realpath: (path) => realpath(path),
  }
}
