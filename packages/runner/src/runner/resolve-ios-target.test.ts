import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IosConfig } from '../config'
import { resolveMetro } from '../plan/resolved'

const execFileMock = vi.hoisted(() => {
  const fn = vi.fn()
  const custom = Symbol.for('nodejs.util.promisify.custom')
  ;(fn as unknown as Record<PropertyKey, unknown>)[custom] = async (
    command: string,
    args: readonly string[],
  ): Promise<{ stdout: string; stderr: string }> => {
    if (command === 'xcrun' && args.join(' ') === 'simctl list devices available --json') {
      return {
        stdout: JSON.stringify({
          devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [
              {
                udid: '0089EDC0-38EB-47D7-8E68-DB4CB80BAD99',
                name: 'iPhone 17',
                state: 'Booted',
                isAvailable: true,
              },
            ],
          },
        }),
        stderr: '',
      }
    }
    if (command === 'xcrun' && args.join(' ') === 'simctl list devices booted') {
      return { stdout: '', stderr: '' }
    }
    throw new Error(`unexpected execFile: ${command} ${args.join(' ')}`)
  }
  return fn
})

vi.mock('node:child_process', () => ({ execFile: execFileMock }))

const { physicalDeviceFromDevicectl, pickPhysicalIosDevice, resolveIosTarget } =
  await import('./resolve')

const COMPANION_PACKAGE = '@unrulysystems/rn-playwright-driver-xctest-companion'
const roots: string[] = []

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('resolveIosTarget', () => {
  it('resolves the scaffold binary from the loaded config project cwd', async () => {
    const projectCwd = await hoistedProjectWithCompanion()
    const ios: IosConfig = {
      bundleId: 'com.example.app',
      workspace: 'ios/App.xcworkspace',
      appScheme: 'App',
      launch: { mode: 'launch', kind: 'plain' },
      // REQ-OWN-001: the mocked simctl lists a booted iPhone, but nothing explicit
      // selects it, so the resolver must be told to adopt it.
      adoptUnownedDevice: true,
    }

    const resolved = await resolveIosTarget(ios, resolveMetro({}), { projectCwd })

    const root = await realpath(path.dirname(path.dirname(projectCwd)))
    expect(resolved.scaffoldBin).toBe(
      path.join(root, 'node_modules', COMPANION_PACKAGE, 'bin', 'scaffold.js'),
    )
    await rm(path.dirname(resolved.tokenFile), { recursive: true, force: true })
  })

  it('resolves the scaffold dependency before touching simulators', async () => {
    const projectCwd = await projectWithoutCompanion()
    const ios: IosConfig = {
      bundleId: 'com.example.app',
      workspace: 'ios/App.xcworkspace',
      appScheme: 'App',
      launch: { mode: 'launch', kind: 'plain' },
    }

    await expect(resolveIosTarget(ios, resolveMetro({}), { projectCwd })).rejects.toThrow(
      /Cannot find module/,
    )
    expect(execFileMock).not.toHaveBeenCalled()
  })
})

describe('pickPhysicalIosDevice', () => {
  const devices = [
    {
      identifier: '40182233-00C8-51ED-8C68-174E14E4B4C9',
      udid: '00008101-001E05A41144001E',
      name: 'Heart Happy iPhone',
      model: 'iPhone 12',
    },
    {
      identifier: '5F926583-22CF-51A7-A3D8-4C9C660C31CA',
      udid: '00008130-0012493614E8001C',
      name: 'Roman Crystal',
      model: 'iPhone 15 Pro Max',
    },
  ]

  it('selects a physical iOS device by UDID, CoreDevice identifier, exact name, or model', () => {
    expect(pickPhysicalIosDevice(devices, '00008130-0012493614E8001C').name).toBe('Roman Crystal')
    expect(pickPhysicalIosDevice(devices, '40182233-00C8-51ED-8C68-174E14E4B4C9').name).toBe(
      'Heart Happy iPhone',
    )
    expect(pickPhysicalIosDevice(devices, 'Roman Crystal').udid).toBe('00008130-0012493614E8001C')
    expect(pickPhysicalIosDevice(devices, 'iPhone 12').name).toBe('Heart Happy iPhone')
  })

  it('requires an explicit selector when multiple physical iOS devices are available', () => {
    expect(() => pickPhysicalIosDevice(devices, undefined)).toThrow(
      /multiple physical iOS devices available/,
    )
  })

  it('fails clearly when a physical iOS selector is missing or ambiguous', () => {
    expect(() => pickPhysicalIosDevice(devices, 'missing')).toThrow(
      /requested iOS device not found/,
    )
    expect(() => pickPhysicalIosDevice(devices, 'iPhone')).toThrow(
      /requested iOS device name is ambiguous/,
    )
  })
})

describe('physicalDeviceFromDevicectl', () => {
  it('accepts paired physical iOS devices that can launch applications', () => {
    const device = physicalDeviceFromDevicectl({
      identifier: '40182233-00C8-51ED-8C68-174E14E4B4C9',
      capabilities: [
        { featureIdentifier: 'com.apple.coredevice.feature.applicationcontrol' },
        { featureIdentifier: 'com.apple.coredevice.feature.launchapplication' },
      ],
      connectionProperties: { pairingState: 'paired' },
      deviceProperties: { name: 'Heart Happy iPhone' },
      hardwareProperties: {
        marketingName: 'iPhone 12',
        platform: 'iOS',
        reality: 'physical',
        udid: '00008101-001E05A41144001E',
      },
    })

    expect(device).toEqual({
      identifier: '40182233-00C8-51ED-8C68-174E14E4B4C9',
      udid: '00008101-001E05A41144001E',
      name: 'Heart Happy iPhone',
      model: 'iPhone 12',
    })
  })
})

async function hoistedProjectWithCompanion(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'rn-resolve-ios-'))
  roots.push(root)

  const companionDir = path.join(root, 'node_modules', COMPANION_PACKAGE)
  await mkdir(path.join(companionDir, 'bin'), { recursive: true })
  await writeFile(
    path.join(companionDir, 'package.json'),
    JSON.stringify({
      name: COMPANION_PACKAGE,
      version: '0.0.0-test',
      bin: { 'rn-driver-xctest-scaffold': 'bin/scaffold.js' },
    }),
  )
  await writeFile(path.join(companionDir, 'bin', 'scaffold.js'), '#!/usr/bin/env node\n')

  const projectCwd = path.join(root, 'packages', 'app')
  await mkdir(path.join(projectCwd, 'node_modules', '.bin'), { recursive: true })
  await writeFile(path.join(projectCwd, 'package.json'), JSON.stringify({ name: 'app' }))
  return projectCwd
}

async function projectWithoutCompanion(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'rn-resolve-ios-missing-'))
  roots.push(root)
  const projectCwd = path.join(root, 'packages', 'app')
  await mkdir(projectCwd, { recursive: true })
  await writeFile(path.join(projectCwd, 'package.json'), JSON.stringify({ name: 'app' }))
  return projectCwd
}
