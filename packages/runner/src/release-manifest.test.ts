import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const runnerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

interface RunnerManifest {
  name?: string
  bin?: Record<string, string>
  files?: string[]
  main?: string
  types?: string
  exports?: Record<string, unknown>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

function manifest(): RunnerManifest {
  return JSON.parse(readFileSync(join(runnerRoot, 'package.json'), 'utf8')) as RunnerManifest
}

describe('runner release manifest', () => {
  it('ships the runnable bin, built dist output, readme, and license', () => {
    const pkg = manifest()

    expect(pkg.name).toBe('@unrulysystems/rn-playwright-driver-runner')
    expect(pkg.files).toEqual(expect.arrayContaining(['bin', 'dist', 'LICENSE', 'README.md']))
    expect(pkg.files).not.toContain('src')
    expect(pkg.main).toBe('dist/index.js')
    expect(pkg.types).toBe('dist/index.d.ts')
    expect(pkg.exports).toHaveProperty('.')

    const binPath = pkg.bin?.['rn-driver']
    expect(binPath).toBe('bin/rn-driver.ts')

    const bin = readFileSync(join(runnerRoot, binPath ?? ''), 'utf8')
    expect(bin).toContain('#!/usr/bin/env bun')
    expect(bin).toContain("import { run } from '../dist/cli.mjs'")
    expect(statSync(join(runnerRoot, binPath ?? '')).mode & 0o111).not.toBe(0)
  })

  it('does not ship workspace protocol dependencies', () => {
    const pkg = manifest()
    const offenders: string[] = []

    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
      for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
        if (spec.startsWith('workspace:')) {
          offenders.push(`${field}.${name} = ${spec}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
