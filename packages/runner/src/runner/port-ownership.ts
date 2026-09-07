import type { FreePortSpec } from '../plan/types'

/** A host process LISTENing on the companion port (`lsof`), with its command line (`ps -o args=`). */
export interface PortListener {
  readonly pid: number
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
  return spec.owner.platform === 'ios' && listener.args.includes(spec.owner.targetId)
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
