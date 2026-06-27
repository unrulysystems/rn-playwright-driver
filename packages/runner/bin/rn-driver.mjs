#!/usr/bin/env node
import { run } from '../dist/cli.mjs'

try {
  process.exitCode = await run(process.argv.slice(2))
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
