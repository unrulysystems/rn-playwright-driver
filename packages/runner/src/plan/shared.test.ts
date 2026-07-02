import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { playwrightCommand, resolvePackageBin } from './shared'

const PW = { config: 'playwright.config.ts', specs: ['e2e/a.spec.ts', 'e2e/b'] }
const tmpRoots: string[] = []

afterEach(() => {
  for (const dir of tmpRoots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('resolvePackageBin', () => {
  it('resolves a workspace-local package binary', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rn-bin-local-'))
    tmpRoots.push(root)
    const app = path.join(root, 'app')
    const bin = path.join(app, 'node_modules', '.bin', 'playwright')
    mkdirSync(path.dirname(bin), { recursive: true })
    writeFileSync(bin, '#!/bin/sh\n')

    expect(resolvePackageBin('playwright', app)).toBe(bin)
  })

  it('walks up to a hoisted package binary when the app workspace has no .bin entry', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rn-bin-hoist-'))
    tmpRoots.push(root)
    const app = path.join(root, 'packages', 'app')
    mkdirSync(path.join(app, 'node_modules', '.bin'), { recursive: true })
    const bin = path.join(root, 'node_modules', '.bin', 'expo')
    mkdirSync(path.dirname(bin), { recursive: true })
    writeFileSync(bin, '#!/bin/sh\n')

    expect(resolvePackageBin('expo', app)).toBe(bin)
  })

  it('falls back to the project-local package binary path when no installed bin is visible', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rn-bin-missing-'))
    tmpRoots.push(root)

    expect(resolvePackageBin('expo', root)).toBe(path.join(root, 'node_modules', '.bin', 'expo'))
  })
})

describe('playwrightCommand (REQ-CLI-005)', () => {
  it('uses the config spec list when no positional specs are given', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rn-bin-playwright-'))
    tmpRoots.push(root)
    const bin = path.join(root, 'node_modules', '.bin', 'playwright')
    mkdirSync(path.dirname(bin), { recursive: true })
    writeFileSync(bin, '#!/bin/sh\n')

    const cmd = playwrightCommand(PW, [], [], root)

    expect(cmd.command).toBe(bin)
    expect(cmd.args).toEqual([
      'test',
      '--config',
      'playwright.config.ts',
      'e2e/a.spec.ts',
      'e2e/b',
      '--reporter=line',
    ])
  })

  it('positional specs override the config spec list', () => {
    const cmd = playwrightCommand(PW, ['e2e/only.spec.ts'], [])
    expect(cmd.args).toContain('e2e/only.spec.ts')
    expect(cmd.args).not.toContain('e2e/a.spec.ts')
  })

  it('REGRESSION: a passthrough-only call keeps the config specs AND appends passthrough', () => {
    const cmd = playwrightCommand(PW, [], ['--grep', '@smoke'])
    // Config specs are NOT dropped just because passthrough flags were supplied.
    expect(cmd.args).toEqual(expect.arrayContaining(['e2e/a.spec.ts', 'e2e/b']))
    expect(cmd.args.join(' ')).toContain('--grep @smoke')
  })

  it('combines positional specs with passthrough flags', () => {
    const cmd = playwrightCommand(PW, ['e2e/only.spec.ts'], ['--workers', '1'])
    expect(cmd.args).toContain('e2e/only.spec.ts')
    expect(cmd.args).not.toContain('e2e/a.spec.ts')
    expect(cmd.args.join(' ')).toContain('--workers 1')
  })
})
