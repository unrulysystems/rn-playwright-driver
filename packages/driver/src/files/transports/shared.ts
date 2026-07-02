/** Shared error mapping for the file-I/O transports. */
import { FileIoError } from '../errors'

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Map a Node fs rejection to the FileIoError taxonomy (ENOENT → NOT_FOUND).
 * `displayPath` is the path to name in the message — it may be a REMOTE container path
 * (adb/simctl reads) OR a HOST/local path (a push source, a staged temp file), so the
 * name is neutral rather than `remote`. Unlike classifyCliFailure, this path is NOT
 * masked: a Node fs error is host-side, so echoing the path is a help, not a leak.
 */
export function mapNodeFsError(error: unknown, displayPath: string): FileIoError {
  if (error instanceof FileIoError) return error
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'ENOENT') {
    return new FileIoError('NOT_FOUND', `device.files: no such file: ${displayPath}`, {
      cause: error,
    })
  }
  return new FileIoError(
    'TRANSPORT_FAILED',
    `device.files: ${displayPath}: ${errorMessage(error)}`,
    {
      cause: error,
    },
  )
}

// File-specific NOT_FOUND markers only — a bare `not found` is intentionally
// EXCLUDED so a device/tool-availability failure (see below) is not misread as a
// missing remote file (REQ-FILES-005/007).
const NOT_FOUND_MARKERS = [/no such file/i, /does not exist/i, /couldn't be found/i]
const UNSUPPORTED_MARKERS = [
  /run-as:.*(not debuggable|package not (debuggable|found)|is unknown)/i,
  /not an application/i,
  /is not (debuggable|an application)/i,
]
// The tool ran but the target device/tool is unreachable — a transport failure,
// never a remote-file NOT_FOUND. Its text ("device 'X' not found") says "not found"
// but names no missing FILE, which is why NOT_FOUND_MARKERS above are file-specific
// (no bare `/not found/`) and this bucket is checked before them.
//
// The caller-controlled remote path is already MASKED out before matching (see
// classifyCliFailure), so no path substring can trip these. The first two markers
// carry an ADDITIONAL `adb:`/`error:` prefix anchor as defense in depth (the
// `device <serial>` / `no devices` phrases are the ones a path could plausibly
// echo); the last two are diagnostic phrases distinctive enough to need no anchor.
const DEVICE_ERROR_PREFIX = String.raw`(?:^|\n)\s*(?:adb|error):\s*`
const DEVICE_UNAVAILABLE_MARKERS = [
  new RegExp(`${DEVICE_ERROR_PREFIX}device\\b[^\\n]*\\b(?:not found|offline|unauthorized)\\b`, 'i'),
  new RegExp(`${DEVICE_ERROR_PREFIX}no devices?/emulators? found`, 'i'),
  /unable to (?:find|locate) (?:device|utility)/i,
  /: command not found/i,
]

/**
 * Classify a non-zero CLI result into the FileIoError taxonomy. `diagnostic` is
 * the tool's folded failure text — for adb that is `cat`'s stdout+stderr (which
 * echoes the remote path, e.g. `cat: <path>: <errno>`), for devicectl it is
 * stderr plus the JSON-output body.
 *
 * Because the caller-controlled remote path is folded in, it is MASKED out before
 * any marker matching: a filename that contains a marker phrase ("no such file",
 * "device offline", …) must not steer classification — only the tool's OWN error
 * text may. Without this, a missing file named "device offline.log" misreads as
 * TRANSPORT_FAILED, and a non-missing failure on a file named "no such file.txt"
 * (`Is a directory`/`Permission denied`) misreads as NOT_FOUND. The device markers
 * are additionally anchored to the tool's `adb:`/`error:` prefix as defense in
 * depth in case the path is echoed in a form that doesn't match `remote` verbatim.
 */
export function classifyCliFailure(
  tool: string,
  remote: string,
  diagnostic: string,
  code: number,
): FileIoError {
  const detail = diagnostic.trim() || `exit ${code}`
  // Mask every verbatim occurrence of the remote path so it never participates in
  // marker matching (plain-string split/join — no regex-escaping needed).
  const scannable = remote.length > 0 ? diagnostic.split(remote).join('<path>') : diagnostic
  // Check container-access (run-as) markers FIRST: `run-as: package not found` is a
  // debuggable/access failure, not a missing remote file. It shares the word "found"
  // with the device markers below, so classify it here before either bucket.
  if (UNSUPPORTED_MARKERS.some((re) => re.test(scannable))) {
    return new FileIoError(
      'UNSUPPORTED',
      `device.files: ${remote} is not reachable — the app build must be debuggable/development-signed (${detail})`,
    )
  }
  // Device/tool unavailability before NOT_FOUND: `device 'X' not found` is a
  // transport failure, not a missing remote file.
  if (DEVICE_UNAVAILABLE_MARKERS.some((re) => re.test(scannable))) {
    return new FileIoError(
      'TRANSPORT_FAILED',
      `device.files: ${tool} could not reach the device for ${remote}: ${detail}`,
    )
  }
  if (NOT_FOUND_MARKERS.some((re) => re.test(scannable))) {
    return new FileIoError('NOT_FOUND', `device.files: no such file: ${remote} (${detail})`)
  }
  return new FileIoError(
    'TRANSPORT_FAILED',
    `device.files: ${tool} failed for ${remote}: ${detail}`,
  )
}
