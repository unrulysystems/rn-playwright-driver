import path from 'node:path'
import type { IosDefaultValue } from '../plan/types'

/**
 * The `NSUserDefaults.standard` domain of a sandboxed simulator app lives in its
 * data container, not in the simulator-wide domain that `simctl spawn defaults
 * write <bundleId>` targets (REQ-IOS-005). `container` is the raw stdout of
 * `simctl get_app_container <udid> <bundleId> data`.
 */
export function appPreferencesPlist(container: string, bundleId: string): string {
  const root = container.trim()
  if (root.length === 0) {
    throw new Error(`simctl printed no app container for ${bundleId}`)
  }
  return path.join(root, 'Library', 'Preferences', `${bundleId}.plist`)
}

/** `defaults write <plist> <key> <typed value>` — every value carries an explicit type flag. */
export function defaultsWriteArgs(plist: string, key: string, value: IosDefaultValue): string[] {
  const typed =
    typeof value === 'boolean'
      ? ['-bool', value ? 'YES' : 'NO']
      : typeof value === 'number'
        ? [Number.isInteger(value) ? '-int' : '-float', String(value)]
        : ['-string', value]
  return ['defaults', 'write', plist, key, ...typed]
}
