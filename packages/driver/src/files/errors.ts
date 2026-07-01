/**
 * Error taxonomy for the device file-I/O surface (`device.files`). The surface
 * fails closed: every failure is a typed {@link FileIoError}, never a silent
 * empty or partial Buffer. See `packages/driver/SPEC.md` REQ-FILES-007.
 */

/**
 * Stable failure codes for {@link FileIoError}.
 *
 * - `NOT_FOUND` — the remote path does not exist.
 * - `UNAVAILABLE` — required targeting context (udid/bundleId/serial/package) is
 *   missing for the active platform, so no transport can run.
 * - `UNSUPPORTED` — the requested root/transport combination is not supported
 *   (e.g. the `absolute` root on a physical iOS device: devicectl is
 *   domain-scoped and cannot reach outside the app container).
 * - `TRANSPORT_FAILED` — the underlying tool (simctl/devicectl/adb) exited
 *   non-zero or produced output that could not be parsed.
 * - `TOO_LARGE` — a pulled file exceeded the configured `maxBuffer` cap.
 */
export const FILE_IO_ERROR_CODES = [
  'NOT_FOUND',
  'UNAVAILABLE',
  'UNSUPPORTED',
  'TRANSPORT_FAILED',
  'TOO_LARGE',
] as const

export type FileIoErrorCode = (typeof FILE_IO_ERROR_CODES)[number]

/**
 * Error a `device.files` operation rejects with. `code` is one of
 * {@link FileIoErrorCode}; `message` carries the normalized underlying tool
 * message where the failure originated in a transport.
 */
export class FileIoError extends Error {
  readonly code: FileIoErrorCode

  constructor(code: FileIoErrorCode, message: string, options?: { cause?: unknown }) {
    // Guard the ErrorOptions so exactOptionalPropertyTypes is not violated by an
    // explicit `{ cause: undefined }`.
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'FileIoError'
    this.code = code
  }
}
