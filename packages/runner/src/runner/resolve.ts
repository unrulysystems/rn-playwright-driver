import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
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
  type ResolvedMetro,
} from '../plan/resolved'

const run = promisify(execFile)

export interface ResolveOptions {
  /** Explicit device id/serial/destination override from the CLI. */
  readonly device?: string
}

/**
 * Effectful iOS resolution: pick the simulator, terminate stale instances on
 * other booted sims (REQ-IOS-002), and mint a per-run `0600` token file. This is
 * the device-bound layer; it is exercised by the live e2e oracle.
 */
export async function resolveIosTarget(
  ios: IosConfig,
  metro: ResolvedMetro,
  opts: ResolveOptions,
): Promise<ResolvedIosTarget> {
  const { udid, name } = await selectSimulator(ios, opts.device)
  await terminateStaleOnOtherSims(udid, ios.bundleId)

  const tokenFile = await mintTokenFile()
  const scheme = uitestScheme(ios)

  return {
    simUdid: udid,
    simName: name,
    destination: ios.destination ?? `platform=iOS Simulator,id=${udid}`,
    uitestScheme: scheme,
    touchPort: ios.companion?.port ?? DEFAULTS.companionPort,
    companionReadyTimeoutMs: ios.companion?.readyTimeoutMs ?? DEFAULTS.iosCompanionReadyTimeoutMs,
    hermesTimeoutMs: DEFAULTS.hermesTargetTimeoutMs,
    tokenFile,
    runtimeConfigFile: path.join('ios', scheme, 'RNDriverTouchCompanionRuntimeConfig.json'),
    // Resolve the scaffold bin from the project cwd (same one the runner executes
    // under) so a hoisted monorepo finds the repo-root-installed companion.
    scaffoldBin: resolveScaffoldBin(process.cwd()),
    initialUrl: ios.launch.initialUrl ?? metro.url,
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
  const serial = await selectSerial(opts.device)
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
  return pickSimulator(all, deviceOverride, ios.destination)
}

/**
 * Pure simulator selection (REQ-IOS-001 / REQ-CLI-007). Precedence:
 *   1. an explicit UDID (from `--device` or `ios.destination`) — ANY device type,
 *      so an explicitly-named iPad/non-iPhone sim is honored, not filtered out;
 *   2. `--device <name>` matched by exact then substring name (also any type);
 *   3. auto-select: the newest booted iPhone, else the newest available iPhone.
 * The iPhone-only filter applies ONLY to step 3's auto-selection.
 */
export function pickSimulator(
  devices: readonly SimDevice[],
  deviceOverride: string | undefined,
  destination: string | undefined,
): { udid: string; name: string } {
  const explicitUdid = parseUdid(deviceOverride) ?? parseUdid(destination)
  if (explicitUdid) {
    const match = devices.find((device) => device.udid === explicitUdid)
    if (!match) throw new Error(`requested iOS simulator not found: ${explicitUdid}`)
    return { udid: match.udid, name: match.name }
  }

  if (deviceOverride) {
    const byName =
      devices.find((device) => device.name === deviceOverride) ??
      devices.find((device) => device.name.includes(deviceOverride))
    if (!byName) throw new Error(`requested iOS simulator not found by name: ${deviceOverride}`)
    return { udid: byName.udid, name: byName.name }
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

async function terminateStaleOnOtherSims(keepUdid: string, bundleId: string): Promise<void> {
  const booted = await capture('xcrun', ['simctl', 'list', 'devices', 'booted'])
  const udids = booted.match(/[0-9A-Fa-f-]{36}/g) ?? []
  for (const udid of udids) {
    if (udid === keepUdid) continue
    await capture('xcrun', ['simctl', 'terminate', udid, bundleId]).catch(() => '')
  }
}

async function selectSerial(deviceOverride?: string): Promise<string> {
  await capture('adb', ['start-server']).catch(() => '')
  if (deviceOverride) {
    await run('adb', ['-s', deviceOverride, 'get-state'])
    return deviceOverride
  }
  const devices = await capture('adb', ['devices'])
  const serial = devices
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .find((cols) => cols[1] === 'device' && cols[0]?.startsWith('emulator-'))?.[0]
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
