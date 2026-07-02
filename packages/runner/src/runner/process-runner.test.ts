import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { metroTargetMatchesDeviceName, readWatchedLog, resolvePackageBin } from './process-runner'

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

describe('resolvePackageBin', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rn-package-bin-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('resolves a workspace-local package binary', async () => {
    const app = join(dir, 'local-app')
    const bin = join(app, 'node_modules', '.bin', 'playwright')
    await mkdir(join(app, 'node_modules', '.bin'), { recursive: true })
    await writeFile(bin, '#!/bin/sh\n')

    expect(resolvePackageBin('playwright', app)).toBe(bin)
  })

  it('walks up to a hoisted package binary when the app workspace has no .bin entry', async () => {
    const root = join(dir, 'hoisted-root')
    const app = join(root, 'packages', 'app')
    const bin = join(root, 'node_modules', '.bin', 'expo')
    await mkdir(join(app, 'node_modules', '.bin'), { recursive: true })
    await mkdir(join(root, 'node_modules', '.bin'), { recursive: true })
    await writeFile(bin, '#!/bin/sh\n')

    expect(resolvePackageBin('expo', app)).toBe(bin)
  })

  it('throws a clear error when no installed package binary exists', () => {
    expect(() => resolvePackageBin('expo', join(dir, 'missing'))).toThrow(
      /could not resolve installed binary/,
    )
  })
})

describe('metroTargetMatchesDeviceName', () => {
  it('matches deviceName directly', () => {
    expect(
      metroTargetMatchesDeviceName({ appId: 'com.acme.app', deviceName: 'iPhone 17' }, 'iPhone 17'),
    ).toBe(true)
  })

  it('matches a deviceName-less Metro target by trailing title parenthetical', () => {
    expect(
      metroTargetMatchesDeviceName(
        { appId: 'com.acme.app', title: 'com.acme.app (iPhone 17)' },
        'iPhone 17',
      ),
    ).toBe(true)
  })

  it('does not let an iOS simulator name match a longer simulator name', () => {
    expect(
      metroTargetMatchesDeviceName(
        { appId: 'com.acme.app', deviceName: 'iPhone 17 Pro' },
        'iPhone 17',
      ),
    ).toBe(false)
    expect(
      metroTargetMatchesDeviceName(
        { appId: 'com.acme.app', title: 'com.acme.app (iPhone 17 Pro)' },
        'iPhone 17',
      ),
    ).toBe(false)
  })

  it('keeps Android substring matching for Metro model suffixes', () => {
    expect(
      metroTargetMatchesDeviceName(
        { appId: 'com.acme.app', deviceName: 'sdk_gphone64_arm64 - 15 - API 35' },
        'sdk_gphone64_arm64',
      ),
    ).toBe(true)
  })

  it('does not match arbitrary title text outside the trailing parenthetical', () => {
    expect(
      metroTargetMatchesDeviceName(
        { appId: 'com.acme.app', title: 'iPhone 17 — Hermes' },
        'iPhone 17',
      ),
    ).toBe(false)
  })
})
