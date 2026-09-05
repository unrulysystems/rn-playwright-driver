/**
 * The runner-emitted marker (REQ-SEAM-001). Every seam in this package — the Metro helper and
 * the config plugin — reads it and nothing else, so app source never does.
 */
export const E2E_MARKER = 'RN_E2E'
const E2E_MARKER_VALUE = '1'

export type EnvLike = Readonly<Record<string, string | undefined>>

export function isE2EMarked(env: EnvLike): boolean {
  return env[E2E_MARKER] === E2E_MARKER_VALUE
}
