import { describe, expect, it } from 'vitest'
import { appPreferencesPlist, defaultsWriteArgs } from './ios-defaults'

describe('appPreferencesPlist', () => {
  it('points at the app container preferences domain, tolerating the trailing newline simctl prints', () => {
    expect(appPreferencesPlist('/sim/data/Containers/Data/Application/ABC\n', 'com.foo.app')).toBe(
      '/sim/data/Containers/Data/Application/ABC/Library/Preferences/com.foo.app.plist',
    )
  })

  it('rejects an empty container path (simctl printed nothing)', () => {
    expect(() => appPreferencesPlist('  \n', 'com.foo.app')).toThrow(/app container/)
  })
})

describe('defaultsWriteArgs', () => {
  const plist = '/c/Library/Preferences/com.foo.app.plist'
  it('types booleans, integers, floats, and strings explicitly so defaults never guesses', () => {
    expect(defaultsWriteArgs(plist, 'Flag', true)).toEqual([
      'defaults',
      'write',
      plist,
      'Flag',
      '-bool',
      'YES',
    ])
    expect(defaultsWriteArgs(plist, 'Flag', false)).toEqual([
      'defaults',
      'write',
      plist,
      'Flag',
      '-bool',
      'NO',
    ])
    expect(defaultsWriteArgs(plist, 'Count', 3)).toEqual([
      'defaults',
      'write',
      plist,
      'Count',
      '-int',
      '3',
    ])
    expect(defaultsWriteArgs(plist, 'Ratio', 1.5)).toEqual([
      'defaults',
      'write',
      plist,
      'Ratio',
      '-float',
      '1.5',
    ])
    expect(defaultsWriteArgs(plist, 'Host', '127.0.0.1:8081')).toEqual([
      'defaults',
      'write',
      plist,
      'Host',
      '-string',
      '127.0.0.1:8081',
    ])
  })
})
