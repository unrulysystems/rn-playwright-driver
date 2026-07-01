/** Shared error mapping for the file-I/O transports. */
import { FileIoError } from '../errors'

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Map a Node fs rejection to the FileIoError taxonomy (ENOENT → NOT_FOUND). */
export function mapNodeFsError(error: unknown, remote: string): FileIoError {
  if (error instanceof FileIoError) return error
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'ENOENT') {
    return new FileIoError('NOT_FOUND', `device.files: no such file: ${remote}`, { cause: error })
  }
  return new FileIoError('TRANSPORT_FAILED', `device.files: ${remote}: ${errorMessage(error)}`, {
    cause: error,
  })
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
// never a remote-file NOT_FOUND. `adb: device 'X' not found` matches the bare
// "not found" that NOT_FOUND deliberately dropped, so classify it here first.
const DEVICE_UNAVAILABLE_MARKERS = [
  /device (?:'[^']*'|"[^"]*"|\S+)? ?(?:not found|offline|unauthorized)/i,
  /no devices?\/emulators? found/i,
  /unable to (?:find|locate) (?:device|utility)/i,
  /command not found/i,
]

/** Classify a non-zero CLI result (stderr text) into the FileIoError taxonomy. */
export function classifyCliFailure(
  tool: string,
  remote: string,
  stderr: string,
  code: number,
): FileIoError {
  const detail = stderr.trim() || `exit ${code}`
  // Check container-access (run-as) markers FIRST: `run-as: package not found`
  // matches the broad `/not found/i` too, but it is a debuggable/access failure,
  // not a missing remote file.
  if (UNSUPPORTED_MARKERS.some((re) => re.test(stderr))) {
    return new FileIoError(
      'UNSUPPORTED',
      `device.files: ${remote} is not reachable — the app build must be debuggable/development-signed (${detail})`,
    )
  }
  // Device/tool unavailability before NOT_FOUND: `device 'X' not found` is a
  // transport failure, not a missing remote file.
  if (DEVICE_UNAVAILABLE_MARKERS.some((re) => re.test(stderr))) {
    return new FileIoError(
      'TRANSPORT_FAILED',
      `device.files: ${tool} could not reach the device for ${remote}: ${detail}`,
    )
  }
  if (NOT_FOUND_MARKERS.some((re) => re.test(stderr))) {
    return new FileIoError('NOT_FOUND', `device.files: no such file: ${remote} (${detail})`)
  }
  return new FileIoError(
    'TRANSPORT_FAILED',
    `device.files: ${tool} failed for ${remote}: ${detail}`,
  )
}
