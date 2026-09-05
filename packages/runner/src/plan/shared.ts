import path from 'node:path'
import type { PlaywrightConfig } from '../config'
import { E2E_MARKER_ENV, METRO_NODE_OPTIONS } from '../constants'
import type { ResolvedMetro } from './resolved'
import type { CommandSpec, Step } from './types'

/** Command constructors. Secret values NEVER flow through these — only paths. */

export function cmd(command: string, args: string[], cwd?: string): CommandSpec {
  return { command, args, ...(cwd ? { cwd } : {}) }
}

export function packageBin(bin: string, args: string[], cwd?: string): CommandSpec {
  // Resolved by NodeProcessRunner at the OS boundary. npm exec/npx can touch npm
  // resolution/network paths and hang before the verifier ever reaches Metro.
  return { command: bin, args, packageBin: true, ...(cwd ? { cwd } : {}) }
}

export function projectPath(projectCwd: string | undefined, relativePath: string): string {
  if (!projectCwd || path.isAbsolute(relativePath) || relativePath.startsWith('<')) {
    return relativePath
  }
  return path.join(projectCwd, relativePath)
}

function shell(command: string, cwd?: string): CommandSpec {
  return { command: 'sh', args: ['-c', command], ...(cwd ? { cwd } : {}) }
}

/** The Metro start step, shared by both platforms. */
export function metroStartStep(metro: ResolvedMetro, cwd?: string): Step {
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
      // Either form carries the e2e marker so the Metro seam installs the harness
      // (REQ-SEAM-001) and binds loopback as IPv4 (REQ-METRO-005): Expo rewrites
      // `localhost` to `127.0.0.1` in the URLs it hands the app, while a Node that
      // resolves `localhost` to `::1` first would bind only the IPv6 loopback.
      command: metro.command
        ? { ...shell(metro.command, cwd), env: E2E_MARKER_ENV, appendEnv: METRO_NODE_OPTIONS }
        : {
            ...packageBin('expo', ['start', '--localhost', '--port', String(metro.port)], cwd),
            env: { CI: '1', EXPO_NO_TELEMETRY: '1', ...E2E_MARKER_ENV },
            appendEnv: METRO_NODE_OPTIONS,
          },
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
  cwd?: string,
): CommandSpec {
  const args = ['test']
  if (playwright?.config) args.push('--config', playwright.config)
  const effectiveSpecs = specs.length > 0 ? specs : (playwright?.specs ?? [])
  args.push(...effectiveSpecs, ...passthrough)
  args.push('--reporter=line')
  return packageBin('playwright', args, cwd)
}
