import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
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
    initialUrl: ios.launch.initialUrl ?? metro.url,
  }
}

/**
 * Effectful Android resolution: pick the emulator serial, verify it is booted,
 * read the device model (the Hermes target's device name), and mint a per-run
 * `0600` token file. Returns the device name to pin via `RN_DEVICE_NAME`.
 */
export async function resolveAndroidTarget(
  android: AndroidConfig,
  _metro: ResolvedMetro,
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
    },
    deviceName,
  }
}

interface SimDevice {
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
  const explicit = parseUdid(deviceOverride) ?? parseUdid(ios.destination)
  const data = JSON.parse(
    await capture('xcrun', ['simctl', 'list', 'devices', 'available', '--json']),
  ) as {
    devices?: Record<string, Array<Omit<SimDevice, 'runtime'>>>
  }
  const all: SimDevice[] = Object.entries(data.devices ?? {})
    .flatMap(([runtime, list]) => list.map((device) => ({ ...device, runtime })))
    .filter((device) => device.isAvailable !== false && device.name.startsWith('iPhone'))

  if (explicit) {
    const match = all.find((device) => device.udid === explicit)
    if (!match) throw new Error(`requested iOS simulator not found: ${explicit}`)
    return { udid: match.udid, name: match.name }
  }

  const byNewest = (a: SimDevice, b: SimDevice) =>
    compareRuntime(runtimeVersion(b.runtime), runtimeVersion(a.runtime))
  const booted = all.filter((device) => device.state === 'Booted').toSorted(byNewest)
  const pick = booted[0] ?? [...all].toSorted(byNewest)[0]
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
