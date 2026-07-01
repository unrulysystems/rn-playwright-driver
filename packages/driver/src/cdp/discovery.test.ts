import { describe, expect, it } from 'vitest'
import { type DebugTarget, selectTarget, selectTargetForConnect } from './discovery'

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

  it('fails closed when more than one runtime matches the deviceName (ambiguity guard)', () => {
    // Two same-named simulators; Metro exposes no UDID to disambiguate. A silent
    // first-pick could attach to the wrong runtime — throw with a generic message.
    const targets = [
      target({ id: 'a', deviceName: 'iPhone 17', title: 'com.acme.app (iPhone 17)' }),
      target({ id: 'b', deviceName: 'iPhone 17', title: 'com.acme.app (iPhone 17)' }),
    ]
    expect(() => selectTarget(targets, { deviceName: 'iPhone 17' })).toThrow(
      /Ambiguous device target/,
    )
  })

  it('prefers an EXACT deviceName over a substring superset (iPhone 17 vs iPhone 17 Pro)', () => {
    // The runner emits the exact selected name; `iPhone 17` must resolve to the
    // `iPhone 17` runtime, not fail closed just because `iPhone 17 Pro` (which
    // contains the needle as a substring) is also connected.
    const exact = target({ id: 'a', deviceName: 'iPhone 17', title: 'com.acme.app (iPhone 17)' })
    const targets = [
      exact,
      target({ id: 'b', deviceName: 'iPhone 17 Pro', title: 'com.acme.app (iPhone 17 Pro)' }),
    ]
    expect(selectTarget(targets, { deviceName: 'iPhone 17' })).toBe(exact)
  })

  it('prefers an exact title parenthetical when targets carry no deviceName field', () => {
    // Metro targets without a `deviceName` embed the device in a trailing paren:
    // `iPhone 17` must resolve to `… (iPhone 17)`, not be ambiguous with
    // `… (iPhone 17 Pro)`.
    const exact = target({ id: 'a', title: 'com.acme.app (iPhone 17)' })
    const targets = [exact, target({ id: 'b', title: 'com.acme.app (iPhone 17 Pro)' })]
    expect(selectTarget(targets, { deviceName: 'iPhone 17' })).toBe(exact)
  })

  it('still substring-matches when there is no exact name match', () => {
    // `iPhone 17 P` matches only `iPhone 17 Pro` as a substring — unambiguous.
    const pro = target({ id: 'b', deviceName: 'iPhone 17 Pro' })
    expect(
      selectTarget([target({ id: 'a', deviceName: 'Pixel 8' }), pro], {
        deviceName: 'iPhone 17 P',
      }),
    ).toBe(pro)
  })

  it('throws a clear error when no target matches the deviceName', () => {
    expect(() =>
      selectTarget([target({ deviceName: 'Pixel 8' })], { deviceName: 'iPhone' }),
    ).toThrow(/No target matching/)
  })

  it('still matches an exact deviceId', () => {
    const t = target({ deviceId: 'UDID-1', deviceName: 'iPhone 17' })
    expect(selectTarget([target({ deviceId: 'UDID-2' }), t], { deviceId: 'UDID-1' })).toBe(t)
  })

  it('defaults to the first target by pageIndex when no selector is given', () => {
    const first = target({ id: 'first' })
    expect(selectTarget([first, target({ id: 'second' })])).toBe(first)
  })
})

describe('selectTargetForConnect (device.files confused-deputy guard)', () => {
  const two = [
    target({ id: 'a', deviceName: 'iPhone 17' }),
    target({ id: 'b', deviceName: 'Pixel 8' }),
  ]

  it('derives filePinned from target.udid and fails closed on ambiguous multi-runtime selection', () => {
    // A concrete iOS device pin (udid) with no CDP selector + >1 runtime → throw.
    expect(() => selectTargetForConnect(two, { target: { udid: 'UDID-1' } })).toThrow(
      /Ambiguous CDP target/,
    )
  })

  it('derives filePinned from target.serial (Android) and fails closed the same way', () => {
    expect(() => selectTargetForConnect(two, { target: { serial: 'emulator-5554' } })).toThrow(
      /Ambiguous CDP target/,
    )
  })

  it('does NOT guard when the target carries no concrete device pin (bundleId only)', () => {
    // Only an app/tool identity → not filePinned → a legitimate multi-runtime
    // connect must default to the first target, not fail closed.
    expect(selectTargetForConnect(two, { target: {} })).toBe(two[0])
    expect(selectTargetForConnect(two, {})).toBe(two[0])
  })

  it('allows a pinned single runtime (no ambiguity to guard)', () => {
    const only = target({ id: 'only', deviceName: 'iPhone 17' })
    expect(selectTargetForConnect([only], { target: { udid: 'UDID-1' } })).toBe(only)
  })

  it('treats an EMPTY-string selector as no selector (must not bypass the guard)', () => {
    // selectTarget ignores a falsy deviceName/deviceId, so an empty string is not a
    // usable CDP selector; it must not let a file pin slip past the multi-runtime
    // guard and silently default to the first target (confused-deputy regression).
    expect(() =>
      selectTargetForConnect(two, { target: { udid: 'UDID-1' }, deviceName: '' }),
    ).toThrow(/Ambiguous CDP target/)
    expect(() => selectTargetForConnect(two, { target: { udid: 'UDID-1' }, deviceId: '' })).toThrow(
      /Ambiguous CDP target/,
    )
  })

  it('honors an explicit pageIndex even when file I/O is pinned (deliberate caller choice)', () => {
    const second = target({ id: 'second' })
    expect(
      selectTargetForConnect([target({ id: 'first' }), second], {
        target: { udid: 'UDID-1' },
        pageIndex: 1,
      }),
    ).toBe(second)
  })

  it('honors an explicit deviceName even when file I/O is pinned', () => {
    const t = target({ id: 'b', deviceName: 'Pixel 8' })
    expect(
      selectTargetForConnect([target({ id: 'a', deviceName: 'iPhone 17' }), t], {
        target: { serial: 'emulator-5554' },
        deviceName: 'Pixel 8',
      }),
    ).toBe(t)
  })
})
