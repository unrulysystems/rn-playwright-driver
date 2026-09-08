import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { AndroidConfig, IosConfig } from '../config'
import { DEFAULTS } from '../constants'
import {
  instrumentationTarget,
  uitestScheme,
  type ResolvedAndroidTarget,
  type ResolvedIosTarget,
  type ResolvedIosTargetBase,
  type ResolvedMetro,
} from '../plan/resolved'

const run = promisify(execFile)

export interface ResolveOptions {
  /** Explicit device id/serial/destination override from the CLI. */
  readonly device?: string
  /** Project/config directory for package resolution that belongs to the app workspace. */
  readonly projectCwd?: string
}

/**
 * Effectful iOS resolution: pick the requested simulator or physical device,
 * perform target-specific pre-run cleanup, and mint a per-run `0600` token file.
 * This is the device-bound layer; it is exercised by the live e2e oracle.
 */
export async function resolveIosTarget(
  ios: IosConfig,
  metro: ResolvedMetro,
  opts: ResolveOptions,
): Promise<ResolvedIosTarget> {
  const scheme = uitestScheme(ios)
  // Resolve the scaffold bin from the project cwd (same one the runner executes
  // under) so a hoisted monorepo finds the repo-root-installed companion. This can
  // throw (companion not installed / no bin entry) — do it BEFORE simulator or
  // token-file side effects so a missing build dependency fails without touching
  // devices or orphaning a `0600` secret on disk.
  const scaffoldBin = resolveScaffoldBin(opts.projectCwd ?? process.cwd())
  if (ios.target === 'device') {
    const device = await selectPhysicalIosDevice(opts.device)
    const tokenFile = await mintTokenFile()

    return {
      ...iosTargetBase(ios, metro, scheme, tokenFile, scaffoldBin),
      kind: 'device',
      id: device.udid,
      deviceName: device.name,
      coreDeviceIdentifier: device.identifier,
      destination: ios.destination ?? `platform=iOS,id=${device.udid}`,
      runtimeTokenFile: path.join('ios', scheme, DEFAULTS.xctestTokenResourceName),
    }
  }
  const { udid, name } = await selectSimulator(ios, opts.device)
  // REQ-IOS-002 is opt-in (REQ-OWN-002): the other booted sims belong to other
  // runs; only when asked are they listed for the planner to terminate the app on.
  const otherBootedSimUdids = ios.terminateOnOtherSimulators ? await otherBootedSims(udid) : []
  const tokenFile = await mintTokenFile()

  return {
    ...iosTargetBase(ios, metro, scheme, tokenFile, scaffoldBin),
    kind: 'simulator',
    id: udid,
    deviceName: name,
    simUdid: udid,
    simName: name,
    otherBootedSimUdids,
    destination: ios.destination ?? `platform=iOS Simulator,id=${udid}`,
  }
}

/** The target-kind-independent half of a resolved iOS target (ports, timeouts, per-run files). */
function iosTargetBase(
  ios: IosConfig,
  metro: ResolvedMetro,
  scheme: string,
  tokenFile: string,
  scaffoldBin: string,
): Omit<ResolvedIosTargetBase, 'kind' | 'id' | 'deviceName' | 'destination'> {
  return {
    uitestScheme: scheme,
    touchPort: ios.companion?.port ?? DEFAULTS.companionPort,
    companionReadyTimeoutMs: ios.companion?.readyTimeoutMs ?? DEFAULTS.iosCompanionReadyTimeoutMs,
    hermesTimeoutMs: DEFAULTS.hermesTargetTimeoutMs,
    tokenFile,
    runtimeConfigFile: path.join('ios', scheme, 'RNDriverTouchCompanionRuntimeConfig.json'),
    scaffoldBin,
    initialUrl: ios.launch.initialUrl ?? metro.url,
    freeUnownedPort: ios.companion?.freeUnownedPort ?? false,
  }
}

/** The companion package + the scaffold bin key it declares in `package.json#bin`. */
const COMPANION_PACKAGE = '@unrulysystems/rn-playwright-driver-xctest-companion'
const SCAFFOLD_BIN_NAME = 'rn-driver-xctest-scaffold'

/**
 * Resolve the XCTest scaffold bin to an ABSOLUTE path, hoist-safely.
 *
 * `createRequire(<cwd>/package.json)` resolves from the consumer project and walks
 * node_modules up to the repo root, so a Yarn-berry hoisted monorepo — where the
 * companion's bin lands in the REPO-ROOT `node_modules` and the app workspace's
 * `.bin` is empty — resolves correctly. The cwd-relative `node_modules/.bin/...`
 * literal this replaces cannot: the runner's cwd is the app workspace. Reading the
 * installed package's own `bin` field pins the installed version, so this stays
 * deterministic (no `npx` registry/version drift — the goal of #22) while becoming
 * hoist-safe. Spawned as `node <abs scaffold.js>`, so it needs no exec bit/shebang.
 */
export function resolveScaffoldBin(cwd: string): string {
  const requireFromProject = createRequire(path.join(cwd, 'package.json'))
  const pkgJsonPath = requireFromProject.resolve(`${COMPANION_PACKAGE}/package.json`)
  const pkg = requireFromProject(pkgJsonPath) as { bin?: Record<string, string> }
  const relBin = pkg.bin?.[SCAFFOLD_BIN_NAME]
  if (!relBin) {
    throw new Error(
      `${COMPANION_PACKAGE} does not declare bin["${SCAFFOLD_BIN_NAME}"]; cannot resolve the XCTest scaffold`,
    )
  }
  return path.join(path.dirname(pkgJsonPath), relBin)
}

/**
 * Effectful Android resolution: pick the emulator serial, verify it is booted,
 * read the device model (the Hermes target's device name), and mint a per-run
 * `0600` token file. Returns the device name to pin via `RN_DEVICE_NAME`.
 */
export async function resolveAndroidTarget(
  android: AndroidConfig,
  metro: ResolvedMetro,
  opts: ResolveOptions,
): Promise<{ resolved: ResolvedAndroidTarget; deviceName: string }> {
  const serial = await selectSerial(android, opts.device)
  await requireBooted(serial)
  const deviceName = (
    await capture('adb', ['-s', serial, 'shell', 'getprop', 'ro.product.model'])
  ).trim()
  const tokenFile = await mintTokenFile()

  return {
    resolved: {
      serial,
      touchPort: android.companion?.port ?? DEFAULTS.companionPort,
      companionReadyTimeoutMs:
        android.companion?.readyTimeoutMs ?? DEFAULTS.androidCompanionReadyTimeoutMs,
      hermesTimeoutMs: DEFAULTS.hermesTargetTimeoutMs,
      tokenFile,
      deviceTokenFileName: DEFAULTS.androidTokenFileName,
      instrumentationTarget: instrumentationTarget(android),
      initialUrl: android.launch.initialUrl ?? metro.url,
      freeUnownedPort: android.companion?.freeUnownedPort ?? false,
    },
    deviceName,
  }
}

export interface SimDevice {
  readonly udid: string
  readonly name: string
  readonly state?: string
  readonly isAvailable?: boolean
  readonly runtime: string
}

export interface PhysicalIosDevice {
  readonly identifier: string
  readonly udid: string
  readonly name: string
  readonly model?: string
}

async function selectSimulator(
  ios: IosConfig,
  deviceOverride?: string,
): Promise<{ udid: string; name: string }> {
  const data = JSON.parse(
    await capture('xcrun', ['simctl', 'list', 'devices', 'available', '--json']),
  ) as {
    devices?: Record<string, Array<Omit<SimDevice, 'runtime'>>>
  }
  const all: SimDevice[] = Object.entries(data.devices ?? {})
    .flatMap(([runtime, list]) => list.map((device) => ({ ...device, runtime })))
    .filter((device) => device.isAvailable !== false)
  return pickSimulator(all, {
    ...(deviceOverride ? { device: deviceOverride } : {}),
    ...(ios.destination ? { destination: ios.destination } : {}),
    adoptUnownedDevice: ios.adoptUnownedDevice ?? false,
  })
}

export interface SimulatorSelection {
  /** `--device`: UDID or name. */
  readonly device?: string
  /** `ios.destination`: may carry an explicit `id=<udid>`. */
  readonly destination?: string
  /** `ios.adoptUnownedDevice`: allow auto-selection when nothing explicit is given. */
  readonly adoptUnownedDevice: boolean
}

/**
 * Pure simulator selection (REQ-IOS-001 / REQ-CLI-007 / REQ-OWN-001). Precedence:
 *   1. an explicit UDID (from `--device` or `ios.destination`) — ANY device type,
 *      so an explicitly-named iPad/non-iPhone sim is honored, not filtered out;
 *   2. `--device <name>` matched by exact then substring name (also any type);
 *   3. nothing explicit: refuse — a booted simulator on a shared host belongs to
 *      another run — unless `adoptUnownedDevice`, then the newest booted iPhone,
 *      else the newest available iPhone.
 * The iPhone-only filter applies ONLY to step 3's auto-selection.
 */
export function pickSimulator(
  devices: readonly SimDevice[],
  selection: SimulatorSelection,
): { udid: string; name: string } {
  const explicitUdid = parseUdid(selection.device) ?? parseUdid(selection.destination)
  if (explicitUdid) {
    const match = devices.find((device) => device.udid === explicitUdid)
    if (!match) throw new Error(`requested iOS simulator not found: ${explicitUdid}`)
    return { udid: match.udid, name: match.name }
  }

  const deviceOverride = selection.device
  if (deviceOverride) {
    const byName =
      devices.find((device) => device.name === deviceOverride) ??
      devices.find((device) => device.name.includes(deviceOverride))
    if (!byName) throw new Error(`requested iOS simulator not found by name: ${deviceOverride}`)
    return { udid: byName.udid, name: byName.name }
  }

  if (!selection.adoptUnownedDevice) {
    const booted = devices
      .filter((device) => device.state === 'Booted')
      .map((device) => `${device.name} (${device.udid})`)
    throw new Error(
      `no --device given and ios.adoptUnownedDevice is off, so no booted simulator is adopted ` +
        `(on a shared host it belongs to another run). Booted: ${
          booted.length > 0 ? booted.join(', ') : 'none'
        }. Pass --device <id|name>, or set ios.adoptUnownedDevice: true to auto-select.`,
    )
  }

  const byNewest = (a: SimDevice, b: SimDevice): number =>
    compareRuntime(runtimeVersion(b.runtime), runtimeVersion(a.runtime))
  const iphones = devices.filter((device) => device.name.startsWith('iPhone'))
  // The package targets ES2022; copy before sorting instead of using ES2023 `toSorted`.
  // oxlint-disable-next-line unicorn/no-array-sort
  const booted = iphones.filter((device) => device.state === 'Booted').sort(byNewest)
  // oxlint-disable-next-line unicorn/no-array-sort
  const pick = booted[0] ?? [...iphones].sort(byNewest)[0]
  if (!pick) throw new Error('no available iPhone simulator found')
  return { udid: pick.udid, name: pick.name }
}

export function pickPhysicalIosDevice(
  devices: readonly PhysicalIosDevice[],
  deviceOverride: string | undefined,
): PhysicalIosDevice {
  if (deviceOverride) {
    const exact = devices.find((device) => physicalDeviceMatches(device, deviceOverride))
    if (exact) return exact
    const byName = devices.filter(
      (device) => device.name.includes(deviceOverride) || device.model?.includes(deviceOverride),
    )
    if (byName.length === 1) return byName[0]!
    if (byName.length > 1) {
      throw new Error(
        `requested iOS device name is ambiguous: ${deviceOverride} (${byName.map((device) => device.name).join(', ')})`,
      )
    }
    throw new Error(`requested iOS device not found: ${deviceOverride}`)
  }

  if (devices.length === 0) throw new Error('no available physical iOS device found')
  if (devices.length > 1) {
    throw new Error(
      `multiple physical iOS devices available; pass --device with one of: ${devices
        .map((device) => `${device.name} (${device.udid})`)
        .join(', ')}`,
    )
  }
  return devices[0]!
}

async function selectPhysicalIosDevice(deviceOverride?: string): Promise<PhysicalIosDevice> {
  return pickPhysicalIosDevice(await listPhysicalIosDevices(), deviceOverride)
}

async function listPhysicalIosDevices(): Promise<PhysicalIosDevice[]> {
  const dir = await mkdtemp(path.join(tmpdir(), 'rn-driver-devicectl-'))
  const file = path.join(dir, 'devices.json')
  try {
    await capture('xcrun', ['devicectl', 'list', 'devices', '--json-output', file])
    const parsed = JSON.parse(await readFile(file, 'utf8')) as DevicectlDeviceList
    return (parsed.result?.devices ?? []).flatMap(
      (device) => physicalDeviceFromDevicectl(device) ?? [],
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

interface DevicectlDeviceList {
  readonly result?: {
    readonly devices?: readonly DevicectlDevice[]
  }
}

interface DevicectlDevice {
  readonly identifier?: unknown
  readonly capabilities?: readonly { readonly featureIdentifier?: unknown }[]
  readonly connectionProperties?: {
    readonly pairingState?: unknown
  }
  readonly deviceProperties?: {
    readonly name?: unknown
  }
  readonly hardwareProperties?: {
    readonly marketingName?: unknown
    readonly platform?: unknown
    readonly reality?: unknown
    readonly udid?: unknown
  }
}

export function physicalDeviceFromDevicectl(
  device: DevicectlDevice,
): PhysicalIosDevice | undefined {
  const platform = device.hardwareProperties?.platform
  const reality = device.hardwareProperties?.reality
  const identifier = device.identifier
  const udid = device.hardwareProperties?.udid
  const name = device.deviceProperties?.name
  if (platform !== 'iOS' || reality !== 'physical') return undefined
  if (
    typeof identifier !== 'string' ||
    typeof udid !== 'string' ||
    typeof name !== 'string' ||
    device.connectionProperties?.pairingState !== 'paired' ||
    !canLaunchPhysicalIosDevice(device.capabilities)
  ) {
    return undefined
  }
  const model = device.hardwareProperties?.marketingName
  return {
    identifier,
    udid,
    name,
    ...(typeof model === 'string' ? { model } : {}),
  }
}

function canLaunchPhysicalIosDevice(
  capabilities: readonly { readonly featureIdentifier?: unknown }[] | undefined,
): boolean {
  return (
    capabilities?.some(
      (capability) =>
        capability.featureIdentifier === 'com.apple.coredevice.feature.launchapplication' ||
        // Older Xcode payloads exposed this as the broad device-connect capability.
        capability.featureIdentifier === 'com.apple.coredevice.feature.connectdevice',
    ) ?? false
  )
}

function physicalDeviceMatches(device: PhysicalIosDevice, value: string): boolean {
  return (
    device.udid === value ||
    device.identifier === value ||
    device.name === value ||
    device.model === value
  )
}

async function otherBootedSims(keepUdid: string): Promise<string[]> {
  const booted = await capture('xcrun', ['simctl', 'list', 'devices', 'booted'])
  const udids = booted.match(/[0-9A-Fa-f-]{36}/g) ?? []
  return udids.filter((udid) => udid !== keepUdid)
}

async function selectSerial(android: AndroidConfig, deviceOverride?: string): Promise<string> {
  await capture('adb', ['start-server']).catch(() => '')
  if (deviceOverride) {
    await run('adb', ['-s', deviceOverride, 'get-state'])
    return deviceOverride
  }
  return pickSerial(await capture('adb', ['devices']), {
    adoptUnownedDevice: android.adoptUnownedDevice ?? false,
  })
}

export interface SerialSelection {
  /** `--device`: adb serial. */
  readonly device?: string
  /** `android.adoptUnownedDevice`: allow adopting the first booted emulator. */
  readonly adoptUnownedDevice: boolean
}

/**
 * Pure serial selection (REQ-AND-001 / REQ-OWN-001): an explicit `--device` wins;
 * otherwise refuse — a booted emulator on a shared host belongs to another run —
 * unless `adoptUnownedDevice`, then the first booted `emulator-*` in `adb devices`.
 */
export function pickSerial(adbDevicesOutput: string, selection: SerialSelection): string {
  if (selection.device) return selection.device
  const bootedEmulators = adbDevicesOutput
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols[1] === 'device' && cols[0]?.startsWith('emulator-'))
    .map((cols) => cols[0] as string)
  if (!selection.adoptUnownedDevice) {
    throw new Error(
      `no --device given and android.adoptUnownedDevice is off, so no booted emulator is adopted ` +
        `(on a shared host it belongs to another run). Booted: ${
          bootedEmulators.length > 0 ? bootedEmulators.join(', ') : 'none'
        }. Pass --device <serial>, or set android.adoptUnownedDevice: true to auto-select.`,
    )
  }
  const serial = bootedEmulators[0]
  if (!serial) throw new Error('no booted emulator found in `adb devices`')
  return serial
}

async function requireBooted(serial: string): Promise<void> {
  const state = (await capture('adb', ['-s', serial, 'get-state'])).trim()
  if (state !== 'device') throw new Error(`adb device ${serial} is not ready (state: ${state})`)
  const booted = (
    await capture('adb', ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'])
  ).trim()
  if (booted !== '1') throw new Error(`adb device ${serial} has not completed boot`)
}

async function mintTokenFile(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'rn-driver-token-'))
  const file = path.join(dir, 'token')
  await writeFile(file, randomBytes(16).toString('hex'))
  await chmod(file, 0o600)
  return file
}

async function capture(command: string, args: string[]): Promise<string> {
  const { stdout } = await run(command, args, { maxBuffer: 16 * 1024 * 1024 })
  return stdout.toString()
}

function parseUdid(value: string | undefined): string | undefined {
  if (!value) return undefined
  const match = value.match(/id=([0-9A-Fa-f-]{36})/) ?? value.match(/^([0-9A-Fa-f-]{36})$/)
  return match?.[1]
}

function runtimeVersion(runtime: string): number[] {
  const match = runtime.match(/iOS-([0-9-]+)$/)
  return match?.[1] ? match[1].split('-').map((part) => Number.parseInt(part, 10)) : [0]
}

function compareRuntime(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}
