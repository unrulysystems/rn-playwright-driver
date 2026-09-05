/**
 * Runtime preflight (REQ-CLI-008): the readiness probes in the process runner
 * use the global `WebSocket` (xctest companion hello) and `fetch` (Metro
 * `/status`, `/json`, instrumentation hello). Node exposes both from 22; bun
 * always has. A missing global used to surface only at the `companion` stage,
 * after prebuild and a full native build, so an unsupported runtime is refused
 * before any effectful step instead.
 */
export const RUNTIME_GLOBALS = ['WebSocket', 'fetch'] as const

export function runtimePreflight(
  version: string,
  globals: Readonly<Record<string, unknown>>,
): string | undefined {
  const missing = RUNTIME_GLOBALS.filter((name) => typeof globals[name] !== 'function')
  if (missing.length === 0) return undefined
  return `${version} has no global ${missing.join(' or ')}; rn-driver's readiness probes need Node >= 22 or bun`
}
