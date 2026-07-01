import { describe, expect, it } from 'vitest'
import { type DebugTarget, selectTarget } from './discovery'

const target = (over: Partial<DebugTarget>): DebugTarget => ({
  id: 'id',
  title: 'app',
  webSocketDebuggerUrl: 'ws://x',
  ...over,
})

describe('selectTarget', () => {
  it('returns the sole target matching a deviceName', () => {
    const t = target({ deviceName: 'iPhone 17', title: 'com.acme.app (iPhone 17)' })
    expect(selectTarget([t, target({ deviceName: 'Pixel 8' })], { deviceName: 'iPhone 17' })).toBe(
      t,
    )
  })

  it('fails closed when more than one runtime matches the deviceName (confused-deputy guard)', () => {
    // Two same-named simulators; Metro exposes no UDID to disambiguate, and
    // device.files pins by UDID — a silent first-pick could diverge. Throw.
    const targets = [
      target({ id: 'a', deviceName: 'iPhone 17', title: 'com.acme.app (iPhone 17)' }),
      target({ id: 'b', deviceName: 'iPhone 17', title: 'com.acme.app (iPhone 17)' }),
    ]
    expect(() => selectTarget(targets, { deviceName: 'iPhone 17' })).toThrow(
      /Ambiguous device target/,
    )
  })

  it('throws a clear error when no target matches the deviceName', () => {
    expect(() =>
      selectTarget([target({ deviceName: 'Pixel 8' })], { deviceName: 'iPhone' }),
    ).toThrow(/No target matching/)
  })

  it('still matches an exact deviceId (unaffected by the name-ambiguity guard)', () => {
    const t = target({ deviceId: 'UDID-1', deviceName: 'iPhone 17' })
    expect(selectTarget([target({ deviceId: 'UDID-2' }), t], { deviceId: 'UDID-1' })).toBe(t)
  })

  it('defaults to the first target by pageIndex when no selector is given', () => {
    const first = target({ id: 'first' })
    expect(selectTarget([first, target({ id: 'second' })])).toBe(first)
  })

  it('fails closed when file I/O is pinned, no CDP selector is given, and multiple runtimes exist', () => {
    // The PROGRAMMATIC confused-deputy: createDevice({ target }) pins file I/O but
    // gives no deviceId/deviceName/pageIndex, so CDP would default to the first of
    // several runtimes — a different app than device.files targets.
    const targets = [
      target({ id: 'a', deviceName: 'iPhone 17' }),
      target({ id: 'b', deviceName: 'Pixel 8' }),
    ]
    expect(() => selectTarget(targets, {}, true)).toThrow(/Ambiguous CDP target/)
  })

  it('does not guard when file I/O is not pinned (multiple runtimes default to the first)', () => {
    // filePinned=false (e.g. a target with only bundleId/adbPath, no udid/serial)
    // must NOT fail a legitimate multi-runtime connect.
    const first = target({ id: 'first' })
    expect(selectTarget([first, target({ id: 'second' })], {}, false)).toBe(first)
  })

  it('allows a pinned single runtime (no ambiguity to guard)', () => {
    const only = target({ id: 'only', deviceName: 'iPhone 17' })
    expect(selectTarget([only], {}, true)).toBe(only)
  })

  it('honors an explicit pageIndex even when file I/O is pinned (deliberate caller choice)', () => {
    const second = target({ id: 'second' })
    expect(selectTarget([target({ id: 'first' }), second], { pageIndex: 1 }, true)).toBe(second)
  })
})
