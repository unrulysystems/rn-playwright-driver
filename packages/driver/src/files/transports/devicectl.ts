/**
 * iOS **physical device** transport (PROVISIONAL — unit-verified; real-hardware
 * E2E pending). Transfers the app-data-container file to/from a host temp file
 * via `xcrun devicectl device copy`. Works only for development-signed apps
 * (`get-task-allow`), which E2E builds are. `--json-output` is the only supported
 * scripted output. See `packages/driver/SPEC.md` REQ-XPORT-003.
 */
import { join } from 'node:path'
import type { FileTransport } from '../device-files'
import { FileIoError } from '../errors'
import type { HostFileExec } from '../host-file-exec'
import { type HostFs, HostFileTooLargeError } from '../host-fs'
import type { ResolvedRemotePath } from '../roots'
import { classifyCliFailure, errorMessage } from './shared'

export interface DevicectlTransportConfig {
  readonly udid: string
  readonly bundleId: string
  readonly xcrunPath: string
}

export function createDevicectlTransport(
  config: DevicectlTransportConfig,
  exec: HostFileExec,
  fs: HostFs,
): FileTransport {
  // `absolute` is blocked upstream for iOS-device (device-files); guard anyway.
  const containerRelative = (path: ResolvedRemotePath): string => {
    if (path.absolute) {
      throw new FileIoError(
        'UNSUPPORTED',
        "device.files: the 'absolute' root is not supported on a physical iOS device (devicectl is container-scoped)",
      )
    }
    return path.subpath
  }

  const copy = (
    direction: 'from' | 'to',
    source: string,
    destination: string,
    jsonOut: string,
  ): readonly string[] => [
    'devicectl',
    'device',
    'copy',
    direction,
    '--device',
    config.udid,
    '--domain-type',
    'appDataContainer',
    '--domain-identifier',
    config.bundleId,
    '--source',
    source,
    '--destination',
    destination,
    '--json-output',
    jsonOut,
  ]

  // Stage in a host temp dir; a staging failure maps into the taxonomy so it
  // never escapes as a raw Node error (REQ-FILES-007).
  const stageDir = async (): Promise<string> => {
    try {
      return await fs.mkdtempDir('rn-driver-devicectl-')
    } catch (error) {
      throw new FileIoError(
        'TRANSPORT_FAILED',
        `device.files: devicectl could not create a staging dir: ${errorMessage(error)}`,
      )
    }
  }

  const assertOk = async (
    result: Awaited<ReturnType<HostFileExec>>,
    remote: string,
    jsonOut: string,
  ): Promise<void> => {
    if (result.code === 0) return
    // The json-output file carries structured error detail; fall back to stderr.
    let detail = result.stderr
    try {
      detail = `${detail} ${(await fs.readFile(jsonOut)).toString('utf8')}`
    } catch {
      // json-output may be absent on an early failure; stderr is enough.
    }
    throw classifyCliFailure('devicectl', remote, detail, result.code)
  }

  // Run one `devicectl copy` and map a spawn-level failure to the taxonomy — a
  // local try/catch, matching the simctl/adb transports (shared by pull and push).
  const runCopy = async (args: readonly string[]): Promise<Awaited<ReturnType<HostFileExec>>> => {
    try {
      return await exec(config.xcrunPath, args)
    } catch (error) {
      throw new FileIoError(
        'TRANSPORT_FAILED',
        `device.files: devicectl failed: ${errorMessage(error)}`,
      )
    }
  }

  return {
    async pull(path, { maxBuffer }) {
      const remote = containerRelative(path)
      const dir = await stageDir()
      const dest = join(dir, 'payload')
      const jsonOut = join(dir, 'result.json')
      try {
        // A physical device's app container is NOT host-mounted (unlike a simulator,
        // which simctl size-probes in place), so `devicectl copy from` — a full-file
        // USB transfer to host temp — is the ONLY way to read any bytes. maxBuffer is
        // therefore enforced on the STAGED payload below, AFTER the copy: peak worker
        // MEMORY still stays at maxBuffer+1 (readFileBounded, REQ-FILES-008), but an
        // oversized remote file does cost the full USB transfer + temp disk before the
        // TOO_LARGE check. This is a provisional physical-device characteristic; there is
        // no documented devicectl remote-stat to fail-fast on before copying.
        const result = await runCopy(copy('from', remote, dest, jsonOut))
        await assertOk(result, remote, jsonOut)
        try {
          // Fast-fail on a known-large staged payload, then a BOUNDED read so peak
          // worker memory stays at maxBuffer+1 even if the file changed size after
          // the probe (REQ-FILES-008).
          const size = await fs.size(dest)
          if (size > maxBuffer) {
            throw new FileIoError(
              'TOO_LARGE',
              `device.files: ${remote} is ${size} bytes, exceeds maxBuffer ${maxBuffer}`,
            )
          }
          return await fs.readFileBounded(dest, maxBuffer)
        } catch (error) {
          if (error instanceof FileIoError) throw error
          if (error instanceof HostFileTooLargeError) {
            throw new FileIoError(
              'TOO_LARGE',
              `device.files: ${remote} exceeds maxBuffer ${maxBuffer} (grew past the size probe)`,
            )
          }
          // The `copy from` already succeeded, so a missing/failed STAGED payload
          // is a host-staging failure, never a missing remote file — do not run
          // it through mapNodeFsError (which would mislabel ENOENT as NOT_FOUND).
          throw new FileIoError(
            'TRANSPORT_FAILED',
            `device.files: staged payload unreadable for ${remote}: ${errorMessage(error)}`,
            { cause: error },
          )
        }
      } finally {
        // Best-effort temp cleanup; a cleanup failure must not mask the result.
        await fs.remove(dir).catch(() => {})
      }
    },

    async push(path, data) {
      const remote = containerRelative(path)
      const dir = await stageDir()
      const src = join(dir, 'payload')
      const jsonOut = join(dir, 'result.json')
      try {
        try {
          await fs.writeFile(src, data)
        } catch (error) {
          // A HOST staging-write failure is a transport failure, never a remote
          // NOT_FOUND — mirror the staged-read path (mapNodeFsError would mislabel
          // an ENOENT staging dir as a missing remote file).
          throw new FileIoError(
            'TRANSPORT_FAILED',
            `device.files: could not stage the payload for ${remote}: ${errorMessage(error)}`,
            { cause: error },
          )
        }
        // PROVISIONAL parent-dir behavior (REQ-FILES-006): unlike simctl (host `fs`
        // seam) and adb (`mkdir -p`), this transport does NOT create intermediate
        // container directories itself — it forwards the nested container-relative path
        // verbatim as `copy to --destination` and relies on `devicectl` to create them.
        // Whether it does is a device-side behavior pending the real-device walkthrough
        // (iOS-device ships provisional). If it does not, assertOk maps the non-zero exit
        // to TRANSPORT_FAILED, so a nested push fails CLOSED — never silently partial.
        const result = await runCopy(copy('to', src, remote, jsonOut))
        await assertOk(result, remote, jsonOut)
      } finally {
        // Best-effort temp cleanup; a cleanup failure must not mask the result.
        await fs.remove(dir).catch(() => {})
      }
    },
  }
}
