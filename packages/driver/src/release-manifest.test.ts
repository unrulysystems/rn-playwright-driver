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

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SHIPPING_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const

// packages/driver/src/<this file> -> packages/
const packagesDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../')

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
