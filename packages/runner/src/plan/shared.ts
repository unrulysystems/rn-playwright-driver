import { existsSync } from 'node:fs'
import path from 'node:path'
import type { PlaywrightConfig } from '../config'
import type { ResolvedMetro } from './resolved'
import type { CommandSpec, Step } from './types'

/** Command constructors. Secret values NEVER flow through these — only paths. */

export function cmd(command: string, args: string[]): CommandSpec {
  return { command, args }
}

export function packageBin(bin: string, args: string[], cwd = process.cwd()): CommandSpec {
  // Use installed package binaries; npm exec/npx can touch npm resolution/network
  // paths and hang before the verifier ever reaches Metro.
  return { command: resolvePackageBin(bin, cwd), args }
}

export function resolvePackageBin(bin: string, cwd = process.cwd()): string {
  const start = path.resolve(cwd)
  for (let dir = start; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', '.bin', bin)
    if (existsSync(candidate)) return candidate
    if (process.platform === 'win32' && existsSync(`${candidate}.cmd`)) return `${candidate}.cmd`
    const parent = path.dirname(dir)
    if (parent === dir) break
  }
  return path.join(start, 'node_modules', '.bin', process.platform === 'win32' ? `${bin}.cmd` : bin)
}

function shell(command: string): CommandSpec {
  return { command: 'sh', args: ['-c', command] }
}

/** The Metro start step, shared by both platforms. */
export function metroStartStep(metro: ResolvedMetro): Step {
  return {
    id: 'metro.start',
    stage: 'metro',
    description: metro.reuseExisting
      ? `Start Metro (reuse if running) ${metro.url}`
      : `Start Metro ${metro.url}`,
    action: {
      type: 'command',
      background: true,
      processKey: 'metro',
      command: metro.command
        ? shell(metro.command)
        : packageBin('expo', ['start', '--localhost', '--port', String(metro.port)]),
    },
  }
}

/**
 * The Playwright invocation, shared by both platforms (REQ-CLI-005). Spec
 * positionals and `--` passthrough are kept distinct: positional specs OVERRIDE
 * the config's spec list, while passthrough flags are ALWAYS appended. This means
 * a passthrough-only call (e.g. `… -- --grep @smoke`) still runs the configured
 * specs — it no longer silently drops them.
 */
export function playwrightCommand(
  playwright: PlaywrightConfig | undefined,
  specs: readonly string[],
  passthrough: readonly string[],
  cwd = process.cwd(),
): CommandSpec {
  const args = ['test']
  if (playwright?.config) args.push('--config', playwright.config)
  const effectiveSpecs = specs.length > 0 ? specs : (playwright?.specs ?? [])
  args.push(...effectiveSpecs, ...passthrough)
  args.push('--reporter=line')
  return packageBin('playwright', args, cwd)
}
