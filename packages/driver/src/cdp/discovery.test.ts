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

  it('derives filePinned from a COMPLETE iOS identity (udid+bundleId) and fails closed', () => {
    // A usable iOS file pin (udid + bundleId) with no CDP selector + >1 runtime → throw.
    expect(() =>
      selectTargetForConnect(two, { target: { udid: 'UDID-1', bundleId: 'com.acme.app' } }),
    ).toThrow(/Ambiguous CDP target/)
  })

  it('derives filePinned from a COMPLETE Android identity (serial+packageName) too', () => {
    expect(() =>
      selectTargetForConnect(two, {
        target: { serial: 'emulator-5554', packageName: 'com.acme.app' },
      }),
    ).toThrow(/Ambiguous CDP target/)
  })

  it('does NOT guard on a lone serial/udid without the app id (device.files would be UNAVAILABLE)', () => {
    // ANDROID_SERIAL / a UDID are device-neutral pins the runner also emits for
    // touch/adb; targetFromEnv records `{ serial }` even with no RN_APP_PACKAGE. Without
    // the app id, device.files can't run, so there is no confused deputy to guard — a
    // plain multi-runtime touch/evaluate connect must NOT fail closed.
    expect(selectTargetForConnect(two, { target: { serial: 'emulator-5554' } })).toBe(two[0])
    expect(selectTargetForConnect(two, { target: { udid: 'UDID-1' } })).toBe(two[0])
  })

  it('does NOT guard when the target carries no device pin (bundleId/packageName only)', () => {
    // Only an app identity → not filePinned → a legitimate multi-runtime connect must
    // default to the first target, not fail closed.
    expect(selectTargetForConnect(two, { target: { bundleId: 'com.acme.app' } })).toBe(two[0])
    expect(selectTargetForConnect(two, { target: {} })).toBe(two[0])
    expect(selectTargetForConnect(two, {})).toBe(two[0])
  })

  it('does NOT guard on an EMPTY-string file identity (device.files would be UNAVAILABLE)', () => {
    // resolveFileTarget rejects a falsy udid/bundleId/serial/packageName as missing, so
    // an empty-string identity is not a usable pin; it must not trip the multi-runtime
    // guard (same empty-string class as the CDP-selector bypass).
    expect(selectTargetForConnect(two, { target: { udid: '', bundleId: '' } })).toBe(two[0])
    expect(selectTargetForConnect(two, { target: { serial: '', packageName: '' } })).toBe(two[0])
    expect(selectTargetForConnect(two, { target: { udid: 'UDID-1', bundleId: '' } })).toBe(two[0])
  })

  it('allows a pinned single runtime (no ambiguity to guard)', () => {
    const only = target({ id: 'only', deviceName: 'iPhone 17' })
    expect(
      selectTargetForConnect([only], { target: { udid: 'UDID-1', bundleId: 'com.acme.app' } }),
    ).toBe(only)
  })

  it('treats an EMPTY-string selector as no selector (must not bypass the guard)', () => {
    // selectTarget ignores a falsy deviceName/deviceId, so an empty string is not a
    // usable CDP selector; it must not let a file pin slip past the multi-runtime
    // guard and silently default to the first target (confused-deputy regression).
    expect(() =>
      selectTargetForConnect(two, {
        target: { udid: 'UDID-1', bundleId: 'com.acme.app' },
        deviceName: '',
      }),
    ).toThrow(/Ambiguous CDP target/)
    expect(() =>
      selectTargetForConnect(two, {
        target: { udid: 'UDID-1', bundleId: 'com.acme.app' },
        deviceId: '',
      }),
    ).toThrow(/Ambiguous CDP target/)
  })

  it('honors an explicit pageIndex even when file I/O is pinned (deliberate caller choice)', () => {
    const second = target({ id: 'second' })
    expect(
      selectTargetForConnect([target({ id: 'first' }), second], {
        target: { udid: 'UDID-1', bundleId: 'com.acme.app' },
        pageIndex: 1,
      }),
    ).toBe(second)
  })

  it('honors an explicit deviceName even when file I/O is pinned', () => {
    const t = target({ id: 'b', deviceName: 'Pixel 8' })
    expect(
      selectTargetForConnect([target({ id: 'a', deviceName: 'iPhone 17' }), t], {
        target: { serial: 'emulator-5554', packageName: 'com.acme.app' },
        deviceName: 'Pixel 8',
      }),
    ).toBe(t)
  })

  it('resolves a file-pinned Android target by SUBSTRING when Metro suffixes the name', () => {
    // The real runner flow: RN_DEVICE_NAME='sdk_gphone64_arm64' but Metro reports
    // 'sdk_gphone64_arm64 - 15 - API 35' (suffixed), with an iOS runtime also connected.
    // Substring fallback is REQUIRED and uniquely resolves the Android target — exact-only
    // was tried and reverted because it broke this. (See SPEC "App-identity facet".)
    const android = target({ id: 'b', deviceName: 'sdk_gphone64_arm64 - 15 - API 35' })
    const targets = [target({ id: 'a', deviceName: 'iPhone 17' }), android]
    expect(
      selectTargetForConnect(targets, {
        target: { serial: 'emulator-5554', packageName: 'com.acme.app' },
        deviceName: 'sdk_gphone64_arm64',
      }),
    ).toBe(android)
  })

  it('under a file pin, honors an EXACT deviceName match (preferred over a substring superset)', () => {
    const wanted = target({ id: 'b', deviceName: 'iPhone 17' })
    const targets = [target({ id: 'a', deviceName: 'iPhone 17 Pro' }), wanted]
    expect(
      selectTargetForConnect(targets, {
        target: { udid: 'UDID-1', bundleId: 'com.acme.app' },
        deviceName: 'iPhone 17',
      }),
    ).toBe(wanted)
  })

  it('fails closed on DUPLICATE exact device names even under a file pin (name ≠ device identity)', () => {
    // Two devices can share an exact name; Metro exposes no UDID (and app id can't prove
    // the device either), so this must stay Ambiguous — never silently pick one.
    const targets = [
      target({ id: 'a', deviceName: 'iPhone 17' }),
      target({ id: 'b', deviceName: 'iPhone 17' }),
    ]
    expect(() =>
      selectTargetForConnect(targets, {
        target: { udid: 'UDID-1', bundleId: 'com.acme.app' },
        deviceName: 'iPhone 17',
      }),
    ).toThrow(/Ambiguous device target/)
  })
})
