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
 *   missing OR present-but-unusable (e.g. a malformed package name that fails the
 *   shell-safety check) for the active platform, so no transport can run.
 * - `UNSUPPORTED` — the environment or the request cannot support this operation, as
 *   opposed to a transient/missing-context failure. Covers, from the CALLER side: an
 *   unknown/unsupported root (roots.ts), a root/transport combination the platform
 *   can't serve (e.g. the `absolute` root on a physical iOS device — devicectl is
 *   domain-scoped and cannot reach outside the app container), an invalid
 *   `target.iosKind`, and an invalid `maxBuffer` (non-positive / non-finite); and from
 *   the DEVICE side (REQ-XPORT-005): an app container that cannot be entered — a
 *   non-debuggable Android build or an unknown package under `run-as` (shared.ts maps
 *   those markers here, not to `NOT_FOUND`). Distinct from `UNAVAILABLE`, which is a
 *   well-formed request the current context can't satisfy.
 * - `TRANSPORT_FAILED` — the underlying tool (simctl/devicectl/adb) exited
 *   non-zero or produced output that could not be parsed.
 * - `TOO_LARGE` — the transferred bytes exceeded the configured `maxBuffer` cap:
 *   a pulled remote file, or a pushed local-file/Buffer source.
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
