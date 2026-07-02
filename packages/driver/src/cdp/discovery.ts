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
 * The device name a Metro target embeds in a trailing parenthetical, e.g.
 * `com.acme.app (iPhone 17)` → `iPhone 17`. Used to make exact-name selection work
 * for targets that carry no separate `deviceName` field. Returns undefined when the
 * title has no trailing `(…)`.
 */
export function titleParenthetical(title: string | undefined): string | undefined {
  return title?.match(/\(([^)]+)\)\s*$/)?.[1]
}

/**
 * Select a specific debug target from discovered targets.
 *
 * Selection priority:
 * 1. deviceId (exact match)
 * 2. deviceName (exact name/title match preferred, else substring — throws if ambiguous)
 * 3. pageIndex (default: 0)
 *
 * Throws if no matching target is found, or if a deviceName is ambiguous.
 * Pure over its selector inputs; the device.files confused-deputy guard lives in
 * {@link selectTargetForConnect}, which wraps this.
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

  // Match by deviceName (case-insensitive)
  if (options.deviceName) {
    const needle = options.deviceName.toLowerCase()
    // Prefer an EXACT name/title match before falling back to substring: the runner
    // emits the selected simulator's exact name (RN_DEVICE_NAME), so `iPhone 17`
    // must resolve to `iPhone 17` even when `iPhone 17 Pro` is also connected —
    // substring-only matching would wrongly call that ambiguous. A `deviceName`-less
    // Metro target embeds the name in a trailing parenthetical (`com.acme.app
    // (iPhone 17)`), so match that exactly too — otherwise it would fall through to
    // substring and be ambiguous with `… (iPhone 17 Pro)`.
    const exact = targets.filter(
      (t) =>
        t.deviceName?.toLowerCase() === needle ||
        t.title?.toLowerCase() === needle ||
        titleParenthetical(t.title)?.toLowerCase() === needle,
    )
    // Substring fallback is REQUIRED, not just a convenience: Metro reports Android
    // device names with a suffix (RN_DEVICE_NAME `sdk_gphone64_arm64` vs the Metro target
    // `sdk_gphone64_arm64 - 15 - API 35`), so the runner's pinned Android target only
    // resolves by substring. Exact is still PREFERRED, and a substring match must be
    // UNIQUE (multiple → Ambiguous below), which is the safety bound — see SPEC
    // "App-identity facet" for why exact-only was tried and reverted.
    const matches =
      exact.length > 0
        ? exact
        : targets.filter(
            (t) =>
              t.deviceName?.toLowerCase().includes(needle) ||
              t.title?.toLowerCase().includes(needle),
          )
    if (matches.length === 0) {
      const available = targets.map((t) => t.deviceName ?? t.title ?? 'unknown').join(', ')
      throw new Error(`No target matching "${options.deviceName}". Available: ${available}`)
    }
    // Fail closed on genuine ambiguity (multiple exact, or multiple substring with no
    // exact). Metro's CDP targets expose no device UDID (only a name/title), so two truly
    // same-named simulators CANNOT be told apart here — not by name, and not by app id
    // either (exact-name equality does not prove same device; an app-id match could be a
    // different same-named device than the pinned udid/serial). Silently taking the first
    // match could attach to the wrong runtime — a loud error beats that; use a unique
    // name or an explicit pageIndex.
    if (matches.length > 1) {
      const available = matches.map((t) => t.title ?? t.deviceName ?? 'unknown').join(', ')
      throw new Error(
        `Ambiguous device target: ${matches.length} runtimes match "${options.deviceName}" (${available}). ` +
          `Metro exposes no UDID to disambiguate — use a unique device name, or select by pageIndex ` +
          `instead (deviceName takes precedence, so pageIndex is ignored while deviceName is set).`,
      )
    }
    return matches[0] as DebugTarget
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

/** Minimal shape of `DeviceOptions` this selector needs (a concrete device pin). */
export type ConnectSelectionOptions = TargetSelectionOptions & {
  target?: { udid?: string; serial?: string; bundleId?: string; packageName?: string }
}

/**
 * Target selection for `RNDevice.connect`, adding the `device.files` confused-deputy
 * guard on top of {@link selectTarget}.
 *
 * Operational contract:
 * - `filePinned` = a COMPLETE file-I/O identity (iOS `udid`+`bundleId` or Android
 *   `serial`+`packageName`); INTERNAL, derived from `options.target`. A lone serial/udid
 *   is NOT a pin (device.files would be UNAVAILABLE), so it never blocks a plain connect.
 * - When file-pinned with NO explicit CDP selector and >1 runtime connected, FAIL CLOSED
 *   (`Ambiguous CDP target`) rather than default to the first — evaluate() could bind to a
 *   different app/device than device.files.
 * - An explicit `deviceName`/`pageIndex` is the operator's deliberate choice, honored as-is
 *   (not auto-cross-checked against the pin).
 *
 * WHY selection can't be smarter, the single-runtime residual, and the two reverted
 * disambiguation shortcuts (app-id tie-break; exact-only deviceName) are documented in
 * `SPEC.md` → "App-identity facet" / "Open items" — the short version: nothing Metro
 * exposes maps to the pinned udid/serial.
 */
export function selectTargetForConnect(
  targets: DebugTarget[],
  options: ConnectSelectionOptions = {},
): DebugTarget {
  const t = options.target
  // A file pin only exists when device.files can ACTUALLY run — i.e. the COMPLETE
  // per-platform identity is present (iOS: udid + bundleId; Android: serial +
  // packageName). A lone serial/udid does NOT count: `ANDROID_SERIAL` (and an iOS
  // UDID) are device-neutral pins the runner also emits for touch/adb, so
  // `targetFromEnv` records `{ serial }` even when no `RN_APP_PACKAGE` is set. If the
  // app identity is missing, resolveFileTarget fails device.files closed as
  // UNAVAILABLE anyway, so there is no evaluate()-vs-files confused deputy to guard —
  // firing here would wrongly block a plain multi-runtime touch/evaluate connect.
  // Truthiness, not `!== undefined`: resolveFileTarget rejects a falsy udid/bundleId/
  // serial/packageName as missing (UNAVAILABLE), so an empty-string identity is NOT a
  // usable file pin and must not trip the guard (it would throw Ambiguous for a target
  // device.files can't even use). Mirrors that falsy check.
  const filePinned =
    (Boolean(t?.udid) && Boolean(t?.bundleId)) || (Boolean(t?.serial) && Boolean(t?.packageName))
  // Mirror selectTarget's OWN truthiness: it enters the deviceId/deviceName branches
  // only for non-empty strings, so an empty string is not a usable selector. Testing
  // `!== undefined` here would let `{ target: { udid }, deviceName: '' }` slip past the
  // guard and then fall through to first-target selection — reopening the very
  // confused-deputy gap this guard closes. pageIndex 0 IS a deliberate choice (and is
  // honored by selectTarget), so it still counts via `!== undefined`.
  const hasCdpSelector =
    Boolean(options.deviceId) || Boolean(options.deviceName) || options.pageIndex !== undefined
  if (filePinned && !hasCdpSelector && targets.length > 1) {
    const available = targets.map((x) => x.deviceName ?? x.title ?? 'unknown').join(', ')
    throw new Error(
      `Ambiguous CDP target: device.files is pinned to a specific device but ${targets.length} ` +
        `runtimes are connected (${available}) and no CDP selector was given. Metro exposes no UDID ` +
        `to match them — pass deviceName or pageIndex so evaluate() and device.files use the same runtime.`,
    )
  }
  // Delegate to the generic selector. Nothing Metro exposes (device name or app id)
  // proves the pinned udid/serial device identity, so CDP selection under a pin is NOT
  // auto-cross-checked against the file target — an explicit deviceName/pageIndex is the
  // operator's deliberate choice, honored as-is. Two disambiguation shortcuts were tried
  // and reverted (both unsound / incompatible with reality): an app-id tie-break (app id
  // ≠ device; bundleId/package collide) and exact-only deviceName (broke the runner's
  // required substring match — Metro suffixes Android names). See SPEC "App-identity facet".
  return selectTarget(targets, options)
}
