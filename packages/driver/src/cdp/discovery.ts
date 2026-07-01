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
/**
 * @param filePinned True when `device.files` is pinned to a concrete device
 *   (`DeviceOptions.target` with a udid/serial). Metro's CDP targets expose no
 *   UDID (see below), so CDP cannot be pinned to the same device — with more than
 *   one runtime and no explicit CDP selector, silently defaulting to the first
 *   target would evaluate against a different app than file I/O reads/writes (a
 *   confused deputy). When set, that case fails closed instead of guessing. Kept
 *   OFF the public `TargetSelectionOptions` — it is internal, derived state.
 */
export function selectTarget(
  targets: DebugTarget[],
  options: TargetSelectionOptions = {},
  filePinned = false,
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
    const matches = targets.filter(
      (t) =>
        t.deviceName?.toLowerCase().includes(needle) || t.title?.toLowerCase().includes(needle),
    )
    if (matches.length === 0) {
      const available = targets.map((t) => t.deviceName ?? t.title ?? 'unknown').join(', ')
      throw new Error(`No target matching "${options.deviceName}". Available: ${available}`)
    }
    // Fail closed on ambiguity. Metro's CDP targets expose no device UDID (only a
    // name/title), so two same-named simulators cannot be told apart here — and
    // `device.files` pins the container by UDID. Silently taking the first match
    // could evaluate against one simulator while file I/O hits another's sandbox
    // (a confused deputy). A loud error beats that; use a unique simulator name.
    if (matches.length > 1) {
      const available = matches.map((t) => t.title ?? t.deviceName ?? 'unknown').join(', ')
      throw new Error(
        `Ambiguous device target: ${matches.length} runtimes match "${options.deviceName}" (${available}). ` +
          `Metro exposes no UDID to disambiguate, and device.files targets by UDID — use a unique simulator name.`,
      )
    }
    return matches[0] as DebugTarget
  }

  // Fail closed on the programmatic confused-deputy: file I/O is pinned to a
  // specific device but no explicit CDP selector was given, and more than one
  // runtime is present. Defaulting to the first target here would attach CDP to a
  // different app than device.files targets. Only guards the implicit default —
  // an explicit pageIndex is the caller's deliberate choice.
  if (filePinned && options.pageIndex === undefined && targets.length > 1) {
    const available = targets.map((t) => t.deviceName ?? t.title ?? 'unknown').join(', ')
    throw new Error(
      `Ambiguous CDP target: device.files is pinned to a specific device but ${targets.length} ` +
        `runtimes are connected (${available}) and no CDP selector was given. Metro exposes no UDID ` +
        `to match them — pass deviceName or pageIndex so evaluate() and device.files use the same runtime.`,
    )
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
