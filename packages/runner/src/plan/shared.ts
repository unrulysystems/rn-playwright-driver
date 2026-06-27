import type { PlaywrightConfig } from '../config'
import type { ResolvedMetro } from './resolved'
import type { CommandSpec, Step } from './types'

/** Command constructors. Secret values NEVER flow through these — only paths. */

export function cmd(command: string, args: string[]): CommandSpec {
  return { command, args }
}

export function npx(args: string[]): CommandSpec {
  return { command: 'npx', args }
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
      command: shell(metro.command ?? `npx expo start --localhost --port ${metro.port}`),
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
): CommandSpec {
  const args = ['playwright', 'test']
  if (playwright?.config) args.push('--config', playwright.config)
  const effectiveSpecs = specs.length > 0 ? specs : (playwright?.specs ?? [])
  args.push(...effectiveSpecs, ...passthrough)
  args.push('--reporter=line')
  return npx(args)
}
