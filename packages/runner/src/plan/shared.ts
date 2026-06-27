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

export function shell(command: string): CommandSpec {
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

/** The Playwright invocation, shared by both platforms. */
export function playwrightCommand(
  playwright: PlaywrightConfig | undefined,
  extraArgs: readonly string[],
): CommandSpec {
  const args = ['playwright', 'test']
  if (playwright?.config) args.push('--config', playwright.config)
  const specs = extraArgs.length > 0 ? extraArgs : (playwright?.specs ?? [])
  args.push(...specs)
  args.push('--reporter=line')
  return npx(args)
}
