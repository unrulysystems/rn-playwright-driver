/**
 * Release-manifest invariant for the whole monorepo.
 *
 * No PUBLISHABLE package may declare an internal dependency via bun's
 * `workspace:` protocol in a SHIPPING dependency field
 * (dependencies / peerDependencies / optionalDependencies).
 *
 * Why this guard exists: CI publishes with `changeset publish`, and
 * `@changesets/cli` only special-cases pnpm — for every other package manager,
 * including bun, it delegates to `npm publish`. npm does NOT rewrite the
 * `workspace:` protocol, so a `"workspace:*"` spec ships verbatim in the
 * tarball and the package becomes uninstallable (`npm install` →
 * EUNSUPPORTEDPROTOCOL). This shipped a broken `@0xbigboss/rn-playwright-driver@0.4.0`
 * once. Internal shipping deps must use real semver ranges (e.g. `^0.1.0`); bun
 * still links them to the local workspace by name. devDependencies are exempt —
 * consumers of a published package never install them.
 *
 * This test lives in the driver package because it is the only workspace whose
 * test suite runs in the shared gate, but it scans the entire `packages/` tree.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SHIPPING_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const

// packages/driver/src/<this file> -> packages/
const packagesDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../')
// packages/driver/src/<this file> -> packages/driver
const driverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

interface Manifest {
  name?: string
  private?: boolean
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

function publishableManifests(): Manifest[] {
  return readdirSync(packagesDir)
    .map((name) => join(packagesDir, name, 'package.json'))
    .filter((p) => existsSync(p))
    .map((p) => JSON.parse(readFileSync(p, 'utf8')) as Manifest)
    .filter((pkg) => pkg.private !== true && typeof pkg.name === 'string')
}

describe('release manifest invariant', () => {
  it('scans the publishable packages (guards against a no-op path bug)', () => {
    // We have several publishable packages; if the scan finds ~none the path is wrong.
    expect(publishableManifests().length).toBeGreaterThan(3)
  })

  it('no publishable package ships a workspace: protocol dependency', () => {
    const offenders: string[] = []
    for (const pkg of publishableManifests()) {
      for (const field of SHIPPING_FIELDS) {
        const deps = pkg[field]
        if (!deps) continue
        for (const [dep, spec] of Object.entries(deps)) {
          if (spec.startsWith('workspace:')) {
            offenders.push(`${pkg.name} → ${field}.${dep} = "${spec}"`)
          }
        }
      }
    }
    expect(
      offenders,
      `These ship an uninstallable "workspace:" spec via 'changeset publish' (npm). ` +
        `Use a real range like ^x.y.z instead:\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})

/**
 * The driver publishes some entrypoints as `.ts` SOURCE (the harness + the
 * rn-inspect bin) so React Native's Metro bundles them in-app. Source that ships
 * must only import other PUBLISHED paths: a relative VALUE import escaping the
 * published `files` (e.g. `harness/index.ts` importing `../src/fill`) resolves
 * fine in the monorepo but is ABSENT from the tarball, breaking the entrypoint
 * for every consumer. The clean-room `require.resolve('./harness')` gate did not
 * follow transitive imports and missed exactly this. This static guard does.
 *
 * Type-only imports (`import type ...`) are excluded — Metro/tsup elide them, so
 * they never reach runtime resolution.
 */

interface DriverManifest extends Manifest {
  files?: string[]
}

/** Directory entries of the driver's published `files` (e.g. bin, dist, harness). */
function publishedDirs(): string[] {
  const pkg = JSON.parse(readFileSync(join(driverRoot, 'package.json'), 'utf8')) as DriverManifest
  return (pkg.files ?? []).filter((entry) => {
    const full = join(driverRoot, entry)
    return existsSync(full) && statSync(full).isDirectory()
  })
}

/** Recursively list `.ts` sources under `dir` (excluding `.d.ts`). */
function listTsSources(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...listTsSources(full))
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

/**
 * Relative specifiers imported/re-exported in VALUE position (statement-level
 * `import type` / `export type` excluded). A mixed
 * `import { value, type X } from '...'` is value-bearing and IS included.
 */
function relativeValueSpecifiers(source: string): string[] {
  const specs: string[] = []
  const re = /(?:import|export)\s+(type\s+)?[^'"]*?from\s+['"](\.[^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) {
    if (match[1]) {
      continue // statement-level `type` — elided, never resolved at runtime
    }
    const spec = match[2]
    if (spec) {
      specs.push(spec)
    }
  }
  return specs
}

describe('driver published-source import boundary', () => {
  it('finds the published source dirs (guards against a no-op path bug)', () => {
    expect(publishedDirs()).toContain('harness')
  })

  it('no published harness/bin source value-imports an unpublished path', () => {
    const dirs = publishedDirs()
    const offenders: string[] = []

    for (const dirName of ['harness', 'bin']) {
      for (const file of listTsSources(join(driverRoot, dirName))) {
        for (const spec of relativeValueSpecifiers(readFileSync(file, 'utf8'))) {
          const targetRel = relative(driverRoot, resolve(dirname(file), spec))
          const firstSegment = targetRel.split(/[/\\]/)[0]
          if (!firstSegment || !dirs.includes(firstSegment)) {
            offenders.push(
              `${relative(driverRoot, file)} → "${spec}" resolves to "${targetRel}", ` +
                `outside the published dirs ${JSON.stringify(dirs)}`,
            )
          }
        }
      }
    }

    expect(
      offenders,
      `Published .ts source must only value-import published paths. A relative value import ` +
        `escaping 'files' is absent from the tarball and breaks the entrypoint for consumers ` +
        `(this is how the harness shipped importing ../src/fill):\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})
