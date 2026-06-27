import { describe, expect, it } from 'vitest'
import { pickSimulator, type SimDevice } from './resolve'

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
  it('auto-selects the newest booted iPhone', () => {
    expect(pickSimulator(DEVICES, undefined, undefined)).toEqual({
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
    expect(pickSimulator(shutdown, undefined, undefined)).toEqual({
      udid: IPHONE_16,
      name: 'iPhone 16 Pro',
    })
  })

  it('honors an explicit UDID from --device, overriding the booted-newest default', () => {
    expect(pickSimulator(DEVICES, IPHONE_16, undefined)).toEqual({
      udid: IPHONE_16,
      name: 'iPhone 16 Pro',
    })
  })

  it('honors an explicit UDID from ios.destination', () => {
    expect(pickSimulator(DEVICES, undefined, `platform=iOS Simulator,id=${IPHONE_15}`)).toEqual({
      udid: IPHONE_15,
      name: 'iPhone 15',
    })
  })

  it('REQ-CLI-007: honors an explicit NON-iPhone UDID (not filtered out by auto-select)', () => {
    expect(pickSimulator(DEVICES, IPAD, undefined)).toEqual({
      udid: IPAD,
      name: 'iPad Pro 11-inch',
    })
  })

  it('REQ-CLI-007: honors --device given as a NAME (exact then substring)', () => {
    expect(pickSimulator(DEVICES, 'iPhone 16 Pro', undefined)).toEqual({
      udid: IPHONE_16,
      name: 'iPhone 16 Pro',
    })
    // Substring match still resolves a unique device.
    expect(pickSimulator(DEVICES, 'iPad', undefined)).toEqual({
      udid: IPAD,
      name: 'iPad Pro 11-inch',
    })
  })

  it('throws on an explicit UDID that is not present', () => {
    expect(() => pickSimulator(DEVICES, '99999999-9999-9999-9999-999999999999', undefined)).toThrow(
      /not found/,
    )
  })

  it('throws on a --device name that matches nothing', () => {
    expect(() => pickSimulator(DEVICES, 'Pixel 9', undefined)).toThrow(/not found by name/)
  })

  it('throws when no iPhone is available and no explicit selection is given', () => {
    const onlyIpad = DEVICES.filter((d) => d.name.startsWith('iPad'))
    expect(() => pickSimulator(onlyIpad, undefined, undefined)).toThrow(/no available iPhone/)
  })
})
