import type { FreePortSpec, PortOwner } from '../plan/types'

/**
 * A host process LISTENing on the companion port, with OS-observed executable paths and
 * its full command line (`ps -o args=`).
 *
 * macOS supplies all `lsof -d txt` mapped paths, including libraries; Linux supplies
 * `/proc/<pid>/exe`. No ordering or unique-executable claim is made for macOS mappings.
 * These paths anchor cooperative lane attribution independently of argv[0]; they do not
 * authenticate a binary against a malicious same-user process. `args` is space-joined argv
 * (quoting is NOT preserved), so unrecognized tokenized shapes fail closed (foreign).
 */
export interface PortListener {
  readonly pid: number
  readonly executablePaths: readonly string[]
  readonly args: string
}

/** One `adb forward --list` row: `<serial> <local> <remote>`. */
export interface AdbForward {
  readonly serial: string
  readonly local: string
  readonly remote: string
}

export interface ObservedPort {
  readonly listeners: readonly PortListener[]
  readonly forwards: readonly AdbForward[]
}

export type ForeignHolder =
  | { readonly kind: 'process'; readonly pid: number; readonly args: string }
  | { readonly kind: 'forward'; readonly serial: string }

/** What the executor may do to the port: the owned holders to free, and the foreign ones it must not touch. */
export interface PortFreePlan {
  readonly killPids: readonly number[]
  readonly removeForwardSerials: readonly string[]
  readonly foreign: readonly ForeignHolder[]
}

/**
 * Pure ownership rule for the companion port (REQ-OWN-003).
 *
 * The adb server is one host process for every lane, so a listener that IS adb
 * is represented by its forward rows (owned or foreign by serial) and is never a
 * kill target; an iOS run therefore never kills the adb server, and an Android
 * run never kills another lane's simulator-hosted companion. `freeUnowned`
 * (config `companion.freeUnownedPort`) turns every foreign holder into an owned one.
 */
export function classifyPortHolders(spec: FreePortSpec, observed: ObservedPort): PortFreePlan {
  const killPids: number[] = []
  const removeForwardSerials: string[] = []
  const foreign: ForeignHolder[] = []

  for (const listener of observed.listeners) {
    if (isAdbServer(listener)) continue
    if (spec.freeUnowned || ownsListener(spec, listener)) killPids.push(listener.pid)
    else foreign.push({ kind: 'process', pid: listener.pid, args: listener.args })
  }
  for (const forward of observed.forwards) {
    if (spec.freeUnowned || ownsForward(spec, forward)) removeForwardSerials.push(forward.serial)
    else foreign.push({ kind: 'forward', serial: forward.serial })
  }
  return { killPids, removeForwardSerials, foreign }
}

function ownsListener(spec: FreePortSpec, listener: PortListener): boolean {
  const owner = spec.owner
  if (owner.platform === 'android') return false
  return owner.kind === 'simulator'
    ? ownsSimulatorCompanion(owner, listener)
    : ownsDeviceForward(owner, spec.port, listener)
}

/**
 * Sim-hosted companion: an observed executable mapping must be the configured XCTest runner
 * (`<uitestScheme>-Runner`) inside the SELECTED simulator's CoreSimulator device path. Both the
 * device-path component (exact UDID match — a partial ID is foreign) and the app/executable
 * basename must match; an unrelated app on the same simulator is foreign. A process whose
 * arguments merely mention the path is never claimed.
 */
function ownsSimulatorCompanion(
  owner: Extract<PortOwner, { platform: 'ios'; kind: 'simulator' }>,
  listener: PortListener,
): boolean {
  return listener.executablePaths.some((executable) => {
    if (!executable.endsWith(`/${owner.runnerExecutable}.app/${owner.runnerExecutable}`)) {
      return false
    }
    const components = executable.split('/')
    const devices = components.findIndex(
      (component, i) => component === 'CoreSimulator' && components[i + 1] === 'Devices',
    )
    return devices !== -1 && components[devices + 2] === owner.simUdid
  })
}

/**
 * Physical-device companion: the host-side holder is the `pymobiledevice3 usbmux forward` process
 * this runner emits. Recognition requires all of:
 *
 * - an OS-observed executable mapping is a Python interpreter or pymobiledevice3 itself — never node
 *   or an arbitrary argv-mention (`ps` rewrites a shebang script's argv to `interpreter script …`,
 *   so the entry point is identified positionally, not by substring);
 * - the command shape is exactly `usbmux forward --serial <hardware UDID> <local> <remote>` in
 *   one of the three emitted/observable forms (direct script argv[0], python entry-point script,
 *   `python -m pymobiledevice3`);
 * - the `--serial` value equals the owner's hardware UDID EXACTLY (a partial ID is foreign) and
 *   the local port equals the port being freed.
 *
 * Any unrecognized option, non-numeric or missing port, or unparseable token fails closed.
 */
function ownsDeviceForward(
  owner: Extract<PortOwner, { platform: 'ios'; kind: 'device' }>,
  port: number,
  listener: PortListener,
): boolean {
  const hasForwardExecutable = listener.executablePaths.some((executable) => {
    const name = basename(executable)
    return name === 'pymobiledevice3' || isPythonInterpreter(name)
  })
  if (!hasForwardExecutable) return false

  const tokens = listener.args.split(/\s+/).filter((token) => token.length > 0)
  const rest = forwardArgv(tokens)
  if (rest === undefined || rest[0] !== 'usbmux' || rest[1] !== 'forward') return false

  let serial: string | undefined
  const ports: string[] = []
  for (let i = 2; i < rest.length; i++) {
    const token = rest[i]!
    if (token === '--serial') {
      if (serial !== undefined || i + 1 >= rest.length) return false
      serial = rest[++i]
    } else if (token.startsWith('--')) {
      return false // unrecognized option — this runner never emits it
    } else if (/^\d+$/.test(token)) {
      ports.push(token)
    } else {
      return false // unparseable positional argument
    }
  }
  return serial === owner.serial && ports.length === 2 && Number(ports[0]) === port
}

/**
 * The argv that follows the executable for a pymobiledevice3 forward: direct script (argv[0]
 * basename `pymobiledevice3`), Python entry-point script (interpreter + script path), or
 * `python -m pymobiledevice3`. Anything else (`-c`, other modules, other scripts, node) is not
 * a forward this runner emitted.
 */
function forwardArgv(tokens: readonly string[]): readonly string[] | undefined {
  const [argv0, maybeScript, maybeModule] = tokens
  if (argv0 === undefined) return undefined
  if (basename(argv0) === 'pymobiledevice3') return tokens.slice(1)
  if (!isPythonInterpreter(basename(argv0))) return undefined
  if (maybeScript !== undefined && basename(maybeScript) === 'pymobiledevice3') {
    return tokens.slice(2)
  }
  if (maybeScript === '-m' && maybeModule === 'pymobiledevice3') return tokens.slice(3)
  return undefined
}

function basename(pathComponent: string): string {
  return pathComponent.split('/').pop() ?? pathComponent
}

/** macOS reports the framework binary (`…/MacOS/Python`); Linux reports `python3.11`-style names. */
function isPythonInterpreter(name: string): boolean {
  return /^python(?:\d+(?:\.\d+)*)?$/i.test(name)
}

function ownsForward(spec: FreePortSpec, forward: AdbForward): boolean {
  return spec.owner.platform === 'android' && forward.serial === spec.owner.serial
}

function isAdbServer(listener: PortListener): boolean {
  const [executable = ''] = listener.args.split(' ')
  return executable === 'adb' || executable.endsWith('/adb')
}

/** Rows of `adb forward --list` whose local end is `tcp:<port>`. */
export function parseAdbForwardList(stdout: string, port: number): AdbForward[] {
  const local = `tcp:${port}`
  return stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((cols): cols is [string, string, string] => cols.length === 3 && cols[1] === local)
    .map(([serial, localEnd, remote]) => ({ serial, local: localEnd, remote }))
}

/** A foreign holder was found and nothing was freed. The message names every holder and the opt-in key. */
export class PortOwnershipError extends Error {
  constructor(spec: FreePortSpec, foreign: readonly ForeignHolder[]) {
    const holders = foreign.map((holder) =>
      holder.kind === 'process'
        ? `pid ${holder.pid} (${holder.args})`
        : `adb forward for ${holder.serial}`,
    )
    super(
      `companion port ${spec.port} is held by another target: ${holders.join('; ')}. ` +
        `Nothing was killed. Give this lane its own ${spec.owner.platform}.companion.port, ` +
        `or set ${spec.owner.platform}.companion.freeUnownedPort: true to reclaim it.`,
    )
    this.name = 'PortOwnershipError'
  }
}
