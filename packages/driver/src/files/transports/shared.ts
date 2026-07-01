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

const NOT_FOUND_MARKERS = [/no such file/i, /not found/i, /does not exist/i, /couldn't be found/i]
const UNSUPPORTED_MARKERS = [
  /run-as:.*(not debuggable|package not (debuggable|found)|is unknown)/i,
  /not an application/i,
  /is not (debuggable|an application)/i,
]

/** Classify a non-zero CLI result (stderr text) into the FileIoError taxonomy. */
export function classifyCliFailure(
  tool: string,
  remote: string,
  stderr: string,
  code: number,
): FileIoError {
  const detail = stderr.trim() || `exit ${code}`
  if (NOT_FOUND_MARKERS.some((re) => re.test(stderr))) {
    return new FileIoError('NOT_FOUND', `device.files: no such file: ${remote} (${detail})`)
  }
  if (UNSUPPORTED_MARKERS.some((re) => re.test(stderr))) {
    return new FileIoError(
      'UNSUPPORTED',
      `device.files: ${remote} is not reachable — the app build must be debuggable/development-signed (${detail})`,
    )
  }
  return new FileIoError(
    'TRANSPORT_FAILED',
    `device.files: ${tool} failed for ${remote}: ${detail}`,
  )
}
