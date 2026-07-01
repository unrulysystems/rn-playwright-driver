/**
 * Transport selection: map a validated {@link ResolvedFileTarget} to its
 * platform transport (REQ-XPORT-001). iOS-simulator → simctl, iOS-device →
 * devicectl, Android → adb.
 */
import type { FileTransport, FileTransportFactory } from '../device-files'
import { createDefaultHostFileExec, type HostFileExec } from '../host-file-exec'
import { createDefaultHostFs, type HostFs } from '../host-fs'
import type { ResolvedFileTarget } from '../target'
import { createAdbTransport } from './adb'
import { createDevicectlTransport } from './devicectl'
import { createSimctlTransport } from './simctl'

export interface FileTransportDeps {
  readonly exec: HostFileExec
  readonly fs: HostFs
}

export function selectFileTransport(
  target: ResolvedFileTarget,
  deps: FileTransportDeps,
): FileTransport {
  if (target.platform === 'android') {
    return createAdbTransport(target, deps.exec)
  }
  if (target.kind === 'device') {
    return createDevicectlTransport(target, deps.exec, deps.fs)
  }
  return createSimctlTransport(target, deps.exec, deps.fs)
}

/**
 * Build a {@link FileTransportFactory} backed by real host processes + fs. Used
 * by {@link RNDevice} to wire `device.files`; tests inject a fake factory instead.
 */
export function createDefaultTransportFactory(): FileTransportFactory {
  const deps: FileTransportDeps = { exec: createDefaultHostFileExec(), fs: createDefaultHostFs() }
  return (target) => selectFileTransport(target, deps)
}
