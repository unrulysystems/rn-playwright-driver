export type DebugTarget = {
  id: string
  title: string
  webSocketDebuggerUrl: string
  vm?: string
  deviceId?: string
  deviceName?: string
  description?: string
}

export type TargetSelectionOptions = {
  /** Select target by device ID (e.g., "00008030-001234567890402E") */
  deviceId?: string
  /** Select target by device name (e.g., "iPhone 15 Pro") */
  deviceName?: string
  /** Select target by page index (default: 0 = first Hermes target) */
  pageIndex?: number
}

/**
 * Discover debug targets from Metro's /json endpoint.
 */
export async function discoverTargets(metroUrl: string): Promise<DebugTarget[]> {
  // Node 18+ has global fetch
  const response = await fetch(`${metroUrl}/json`)
  if (!response.ok) {
    throw new Error(`Failed to fetch debug targets: ${response.status} ${response.statusText}`)
  }
  const targets = (await response.json()) as DebugTarget[]

  // Filter to React Native runtime targets
  // Hermes: title contains "Hermes" or vm === "Hermes"
  // Bridgeless (RN 0.81+): description contains "React Native Bridgeless"
  return targets.filter(
    (t) =>
      t.title?.includes('Hermes') || t.vm === 'Hermes' || t.description?.includes('React Native'),
  )
}

/**
 * Select a specific debug target from discovered targets.
 *
 * Selection priority:
 * 1. deviceId (exact match)
 * 2. deviceName (substring match)
 * 3. pageIndex (default: 0)
 *
 * Throws if no matching target found.
 */
export function selectTarget(
  targets: DebugTarget[],
  options: TargetSelectionOptions = {},
): DebugTarget {
  if (targets.length === 0) {
    throw new Error('No Hermes debug targets found. Is the app running with Metro connected?')
  }

  // Match by deviceId (exact)
  if (options.deviceId) {
    const match = targets.find((t) => t.deviceId === options.deviceId)
    if (!match) {
      const available = targets.map((t) => t.deviceId ?? 'unknown').join(', ')
      throw new Error(`No target with deviceId "${options.deviceId}". Available: ${available}`)
    }
    return match
  }

  // Match by deviceName (substring, case-insensitive)
  if (options.deviceName) {
    const needle = options.deviceName.toLowerCase()
    const match = targets.find(
      (t) =>
        t.deviceName?.toLowerCase().includes(needle) || t.title?.toLowerCase().includes(needle),
    )
    if (!match) {
      const available = targets.map((t) => t.deviceName ?? t.title ?? 'unknown').join(', ')
      throw new Error(`No target matching "${options.deviceName}". Available: ${available}`)
    }
    return match
  }

  // Default: select by page index. The presence check also covers out-of-range
  // indices (negative or >= length both index to undefined under the array type).
  const index = options.pageIndex ?? 0
  const target = targets[index]
  if (!target) {
    throw new Error(`Invalid pageIndex ${index}. Found ${targets.length} target(s).`)
  }
  return target
}
