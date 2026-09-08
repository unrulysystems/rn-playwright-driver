import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pickSerial, pickSimulator, resolveScaffoldBin, type SimDevice } from './resolve'

const RT = (v: string) => `com.apple.CoreSimulator.SimRuntime.iOS-${v}`

const IPHONE_16 = '42F9A94A-83BE-4262-A69E-5A93670D3A6F'
const IPHONE_17 = '0089EDC0-38EB-47D7-8E68-DB4CB80BAD99'
const IPHONE_15 = '11111111-2222-3333-4444-555555555555'
const IPAD = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE'

const DEVICES: SimDevice[] = [
  { udid: IPHONE_16, name: 'iPhone 16 Pro', state: 'Booted', runtime: RT('18-0') },
  { udid: IPHONE_17, name: 'iPhone 17', state: 'Booted', runtime: RT('26-5') },
  { udid: IPHONE_15, name: 'iPhone 15', state: 'Shutdown', runtime: RT('17-0') },
  { udid: IPAD, name: 'iPad Pro 11-inch', state: 'Shutdown', runtime: RT('18-0') },
]

describe('pickSimulator', () => {
  it('REQ-OWN-001: without --device and without adoptUnownedDevice it refuses to adopt, naming the booted candidates and both remedies', () => {
    let message = ''
    try {
      pickSimulator(DEVICES, { adoptUnownedDevice: false })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('no --device given')
    expect(message).toContain(`iPhone 17 (${IPHONE_17})`)
    expect(message).toContain(`iPhone 16 Pro (${IPHONE_16})`)
    expect(message).not.toContain(IPHONE_15)
    expect(message).toContain('--device <id|name>')
    expect(message).toContain('ios.adoptUnownedDevice')
  })

  it('REQ-OWN-001: an explicit --device is honored without adoptUnownedDevice', () => {
    expect(pickSimulator(DEVICES, { device: IPHONE_15, adoptUnownedDevice: false })).toEqual({
      udid: IPHONE_15,
      name: 'iPhone 15',
    })
  })

  it('auto-selects the newest booted iPhone (adoptUnownedDevice)', () => {
    expect(pickSimulator(DEVICES, { adoptUnownedDevice: true })).toEqual({
      udid: IPHONE_17,
      name: 'iPhone 17',
    })
  })

  it('auto-selects the newest available iPhone when none are booted', () => {
    // Exclude the iPhone 17 so the newest remaining iPhone (16 Pro, iOS 18) is the
    // unambiguous winner over iPhone 15 (iOS 17) and the iPad.
    const shutdown = DEVICES.filter((d) => d.udid !== IPHONE_17).map((d) => ({
      ...d,
      state: 'Shutdown',
    }))
    expect(pickSimulator(shutdown, { adoptUnownedDevice: true })).toEqual({
      udid: IPHONE_16,
      name: 'iPhone 16 Pro',
    })
  })

  it('honors an explicit UDID from --device, overriding the booted-newest default', () => {
    expect(pickSimulator(DEVICES, { device: IPHONE_16, adoptUnownedDevice: false })).toEqual({
      udid: IPHONE_16,
      name: 'iPhone 16 Pro',
    })
  })

  it('honors an explicit UDID from ios.destination', () => {
    expect(
      pickSimulator(DEVICES, {
        destination: `platform=iOS Simulator,id=${IPHONE_15}`,
        adoptUnownedDevice: false,
      }),
    ).toEqual({
      udid: IPHONE_15,
      name: 'iPhone 15',
    })
  })

  it('REQ-CLI-007: honors an explicit NON-iPhone UDID (not filtered out by auto-select)', () => {
    expect(pickSimulator(DEVICES, { device: IPAD, adoptUnownedDevice: false })).toEqual({
      udid: IPAD,
      name: 'iPad Pro 11-inch',
    })
  })

  it('REQ-CLI-007: honors --device given as a NAME (exact then substring)', () => {
    expect(pickSimulator(DEVICES, { device: 'iPhone 16 Pro', adoptUnownedDevice: false })).toEqual({
      udid: IPHONE_16,
      name: 'iPhone 16 Pro',
    })
    // Substring match still resolves a unique device.
    expect(pickSimulator(DEVICES, { device: 'iPad', adoptUnownedDevice: false })).toEqual({
      udid: IPAD,
      name: 'iPad Pro 11-inch',
    })
  })

  it('throws on an explicit UDID that is not present', () => {
    expect(() =>
      pickSimulator(DEVICES, {
        device: '99999999-9999-9999-9999-999999999999',
        adoptUnownedDevice: false,
      }),
    ).toThrow(/not found/)
  })

  it('throws on a --device name that matches nothing', () => {
    expect(() => pickSimulator(DEVICES, { device: 'Pixel 9', adoptUnownedDevice: false })).toThrow(
      /not found by name/,
    )
  })

  it('throws when no iPhone is available and no explicit selection is given', () => {
    const onlyIpad = DEVICES.filter((d) => d.name.startsWith('iPad'))
    expect(() => pickSimulator(onlyIpad, { adoptUnownedDevice: true })).toThrow(
      /no available iPhone/,
    )
  })
})

const ADB_DEVICES = [
  'List of devices attached',
  'emulator-5554\tdevice',
  'emulator-5580\tdevice',
  'emulator-5600\toffline',
  'R58M123ABC\tdevice',
  '',
].join('\n')

describe('pickSerial', () => {
  it('honors an explicit --device serial without reading `adb devices`', () => {
    expect(pickSerial('', { device: 'emulator-5580', adoptUnownedDevice: false })).toBe(
      'emulator-5580',
    )
  })

  it('REQ-OWN-001: without --device and without adoptUnownedDevice it refuses to adopt, naming the booted emulators and both remedies', () => {
    let message = ''
    try {
      pickSerial(ADB_DEVICES, { adoptUnownedDevice: false })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('no --device given')
    expect(message).toContain('emulator-5554')
    expect(message).toContain('emulator-5580')
    expect(message).not.toContain('emulator-5600')
    expect(message).toContain('--device <serial>')
    expect(message).toContain('android.adoptUnownedDevice')
  })

  it('adopts the first booted emulator only with adoptUnownedDevice (REQ-AND-001)', () => {
    expect(pickSerial(ADB_DEVICES, { adoptUnownedDevice: true })).toBe('emulator-5554')
  })

  it('adoptUnownedDevice with no booted emulator still fails', () => {
    expect(() =>
      pickSerial('List of devices attached\nR58M123ABC\tdevice\n', { adoptUnownedDevice: true }),
    ).toThrow(/no booted emulator/)
  })
})

const COMPANION_PACKAGE = '@unrulysystems/rn-playwright-driver-xctest-companion'

describe('resolveScaffoldBin', () => {
  const tmpRoots: string[] = []

  afterEach(() => {
    for (const dir of tmpRoots.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /**
   * Lay out a HOISTED monorepo: the companion package (with its `bin`) lives only in
   * the repo-root `node_modules`, and the app workspace's own `node_modules/.bin` is
   * empty. This is the exact Yarn-berry shape that ENOENTs the old cwd-relative
   * `node_modules/.bin/rn-driver-xctest-scaffold` literal. Returns the app-workspace
   * cwd and the absolute path the bin SHOULD resolve to.
   */
  function hoistedMonorepo(bin: Record<string, string> | undefined): {
    cwd: string
    companionDir: string
  } {
    const root = mkdtempSync(path.join(tmpdir(), 'rn-hoist-'))
    tmpRoots.push(root)

    // Companion installed at the repo root (hoisted), NOT in the app workspace.
    const companionDir = path.join(root, 'node_modules', COMPANION_PACKAGE)
    mkdirSync(companionDir, { recursive: true })
    writeFileSync(
      path.join(companionDir, 'package.json'),
      JSON.stringify({ name: COMPANION_PACKAGE, version: '0.0.0-test', ...(bin ? { bin } : {}) }),
    )

    // App workspace with an EMPTY local .bin — the relative literal would miss here.
    const cwd = path.join(root, 'packages', 'app')
    mkdirSync(path.join(cwd, 'node_modules', '.bin'), { recursive: true })
    writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'app', version: '0.0.0' }))

    return { cwd, companionDir }
  }

  it('resolves the scaffold bin to an absolute path when it is hoisted to the repo root', () => {
    const { cwd, companionDir } = hoistedMonorepo({
      'rn-driver-xctest-scaffold': 'bin/scaffold.js',
    })

    const resolved = resolveScaffoldBin(cwd)

    // Walked node_modules up from the app workspace to the repo root (hoist-safe),
    // NOT `<cwd>/node_modules/.bin/...` which is empty here. require.resolve returns
    // a realpath, so normalize the expected dir (macOS /var -> /private/var symlink).
    expect(resolved).toBe(path.join(realpathSync(companionDir), 'bin', 'scaffold.js'))
    expect(path.isAbsolute(resolved)).toBe(true)
    expect(resolved).not.toContain(path.join('packages', 'app', 'node_modules'))
  })

  it('throws when the companion does not declare the scaffold bin', () => {
    const { cwd } = hoistedMonorepo(undefined)
    expect(() => resolveScaffoldBin(cwd)).toThrow(/does not declare bin/)
  })
})
