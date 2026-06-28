import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readWatchedLog } from './process-runner'

// The OS-boundary process runner is verified by the live e2e oracle, NOT unit tests — except
// `readWatchedLog`, whose FAIL-CLOSED contract (a missing/unreadable companion log is a defect, not
// an empty log) is a deterministic filesystem read worth pinning so a regression to the old
// swallow-to-'' behavior can't silently disable fast-fail marker detection again.
describe('readWatchedLog (fail-closed companion log read)', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rn-watched-log-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns the log contents when the file exists (the happy path the marker scan reads)', async () => {
    const path = join(dir, 'companion.log')
    await writeFile(path, 'Testing…\n** TEST FAILED **\n')
    expect(await readWatchedLog(path)).toContain('** TEST FAILED **')
  })

  it('reads an empty (just-created) log as empty, not an error', async () => {
    const path = join(dir, 'empty.log')
    await writeFile(path, '')
    expect(await readWatchedLog(path)).toBe('')
  })

  it('THROWS on a missing log instead of swallowing to "" — spawn guarantees the file exists, so a miss is a defect', async () => {
    await expect(readWatchedLog(join(dir, 'does-not-exist.log'))).rejects.toThrow(
      /cannot read companion log for fast-fail marker detection/,
    )
  })

  it('THROWS on an unreadable path (e.g. a directory / EISDIR), surfacing the real cause', async () => {
    // `dir` itself is a directory: reading it as a file fails with EISDIR — a genuine defect that
    // must propagate rather than be masked as an empty log.
    await expect(readWatchedLog(dir)).rejects.toThrow(
      /cannot read companion log for fast-fail marker detection/,
    )
  })
})
