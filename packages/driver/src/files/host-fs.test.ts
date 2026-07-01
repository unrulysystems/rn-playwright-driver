import { readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createDefaultHostFs, HostFileTooLargeError } from './host-fs'

// Verifies the real host fs seam against a temp dir: the "creates parent
// directories as needed" contract that push relies on (REQ-FILES-006).
const fs = createDefaultHostFs()
const roots: string[] = []

async function scratchRoot(): Promise<string> {
  // mkdtempDir already roots the prefix under the OS temp dir.
  const dir = await fs.mkdtempDir('rn-driver-hostfs-')
  roots.push(dir)
  return dir
}

afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('createDefaultHostFs', () => {
  it('writeFile creates intermediate parent directories (push into a nested path)', async () => {
    const root = await scratchRoot()
    const nested = join(root, 'Documents', 'exports', '2026', 'obs.csv')

    await fs.writeFile(nested, Buffer.from('Interval,Actor'))

    expect((await readFile(nested)).toString()).toBe('Interval,Actor')
  })

  it('round-trips exact bytes and removes recursively', async () => {
    const root = await scratchRoot()
    const path = join(root, 'a', 'bin')
    const payload = Buffer.from([0, 1, 2, 254, 255])

    await fs.writeFile(path, payload)
    expect(Buffer.compare(await fs.readFile(path), payload)).toBe(0)

    await fs.remove(join(root, 'a'))
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('remove ignores a missing path (force)', async () => {
    const root = await scratchRoot()
    await expect(fs.remove(join(root, 'does-not-exist'))).resolves.toBeUndefined()
  })

  describe('readFileBounded (REQ-FILES-008)', () => {
    it('returns exact bytes when the file is at or under the cap', async () => {
      const root = await scratchRoot()
      const path = join(root, 'ok.bin')
      const payload = Buffer.from([0, 1, 2, 254, 255])
      await fs.writeFile(path, payload)

      // At the cap and above the cap both succeed (cap is inclusive).
      expect(Buffer.compare(await fs.readFileBounded(path, payload.length), payload)).toBe(0)
      expect(Buffer.compare(await fs.readFileBounded(path, payload.length + 10), payload)).toBe(0)
    })

    it('throws HostFileTooLargeError without buffering the excess when over the cap', async () => {
      const root = await scratchRoot()
      const path = join(root, 'big.bin')
      await fs.writeFile(path, Buffer.alloc(4096, 7))

      await expect(fs.readFileBounded(path, 1024)).rejects.toBeInstanceOf(HostFileTooLargeError)
    })
  })
})
