import { describe, expect, it } from 'vitest'
import { FileIoError } from './errors'
import { resolveRemotePath } from './roots'

describe('resolveRemotePath — named roots (REQ-FILES-003)', () => {
  it('maps iOS roots to the container subdirs (mirrors expo-file-system)', () => {
    expect(resolveRemotePath('ios', 'document', 'obs.csv')).toEqual({
      absolute: false,
      subpath: 'Documents/obs.csv',
    })
    expect(resolveRemotePath('ios', 'cache', 'thumb.png')).toEqual({
      absolute: false,
      subpath: 'Library/Caches/thumb.png',
    })
    expect(resolveRemotePath('ios', 'data', 'x')).toEqual({ absolute: false, subpath: 'x' })
  })

  it('maps Android roots to the app-home subdirs', () => {
    expect(resolveRemotePath('android', 'document', 'obs.csv')).toEqual({
      absolute: false,
      subpath: 'files/obs.csv',
    })
    expect(resolveRemotePath('android', 'cache', 'thumb.png')).toEqual({
      absolute: false,
      subpath: 'cache/thumb.png',
    })
    expect(resolveRemotePath('android', 'data', 'x')).toEqual({ absolute: false, subpath: 'x' })
  })

  it('passes an absolute path through verbatim', () => {
    expect(resolveRemotePath('android', 'absolute', '/sdcard/Download/x')).toEqual({
      absolute: true,
      path: '/sdcard/Download/x',
    })
  })

  it('rejects a relative path under the absolute root (would resolve vs run-as cwd)', () => {
    // 'foo' with root:'absolute' must not become `cat "foo"` relative to the
    // shell cwd — require a genuine absolute device path (REQ-XPORT-004).
    expect(() => resolveRemotePath('android', 'absolute', 'foo/bar')).toThrow(
      /absolute.*starting with '\/'/,
    )
  })

  it("rejects '..' traversal in an absolute path (defense in depth)", () => {
    expect(() => resolveRemotePath('android', 'absolute', '/data/data/pkg/../x')).toThrow(
      /must not contain '\.\.'/,
    )
  })
})

describe('resolveRemotePath — no-escape rule (REQ-FILES-004)', () => {
  it('treats a leading slash as root-relative, not an escape', () => {
    expect(resolveRemotePath('ios', 'document', '/nested/obs.csv')).toEqual({
      absolute: false,
      subpath: 'Documents/nested/obs.csv',
    })
  })

  it('collapses redundant and "." segments', () => {
    expect(resolveRemotePath('ios', 'document', './a//b/./c')).toEqual({
      absolute: false,
      subpath: 'Documents/a/b/c',
    })
  })

  it('rejects ".." traversal with UNSUPPORTED', () => {
    try {
      resolveRemotePath('ios', 'document', '../../etc/passwd')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(FileIoError)
      expect((error as FileIoError).code).toBe('UNSUPPORTED')
    }
  })

  it('rejects an empty non-absolute path', () => {
    expect(() => resolveRemotePath('android', 'document', '')).toThrow(FileIoError)
    expect(() => resolveRemotePath('android', 'document', '/')).toThrow(FileIoError)
  })

  it('rejects an empty absolute path', () => {
    expect(() => resolveRemotePath('android', 'absolute', '   ')).toThrow(/absolute/)
  })
})
