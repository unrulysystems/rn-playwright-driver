#!/usr/bin/env bun
/**
 * rn-driver CLI entry. Ships as a thin bun-run shim that loads the built CLI
 * from dist (mirroring the driver's rn-inspect bin), so the published package
 * stays Node/bun-runnable without a separate compiled bin.
 */
// Import from dist (built output) since src is not shipped in the package.
import { run } from '../dist/cli.mjs'

run(process.argv.slice(2))
  .then((code) => {
    process.exit(code)
  })
  .catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
