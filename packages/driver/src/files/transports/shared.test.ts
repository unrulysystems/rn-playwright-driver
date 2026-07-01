import { describe, expect, it } from 'vitest'
import { classifyCliFailure } from './shared'

describe('classifyCliFailure', () => {
  it('maps a missing remote file to NOT_FOUND', () => {
    const err = classifyCliFailure(
      'adb',
      '/sdcard/x',
      'cat: /sdcard/x: No such file or directory',
      1,
    )
    expect(err.code).toBe('NOT_FOUND')
  })

  it('maps devicectl "does not exist" to NOT_FOUND', () => {
    expect(
      classifyCliFailure('devicectl', 'Documents/x', 'The requested file does not exist.', 1).code,
    ).toBe('NOT_FOUND')
  })

  it('does NOT misreport a device-not-found as a missing remote file (M#4)', () => {
    // `adb: device 'X' not found` is a transport failure, not a missing file —
    // the bare "not found" must not fall into the NOT_FOUND bucket.
    expect(
      classifyCliFailure('adb', '/sdcard/x', "adb: device 'emulator-5554' not found", 1).code,
    ).toBe('TRANSPORT_FAILED')
  })

  it('maps an offline device to TRANSPORT_FAILED, not NOT_FOUND', () => {
    expect(classifyCliFailure('adb', '/sdcard/x', 'error: device offline', 1).code).toBe(
      'TRANSPORT_FAILED',
    )
  })

  it('maps a MISSING file whose path contains "device offline" to NOT_FOUND, not TRANSPORT_FAILED', () => {
    // adb folds the caller-controlled remote path into the diagnostic (cat's "No
    // such file: <path>"). A file literally named "device offline.log" must not be
    // misclassified as a device-unavailable transport failure — the device markers
    // are anchored to adb's own `adb:`/`error:` prefix, which a path lacks.
    const path = '/data/data/com.acme.app/files/device offline.log'
    expect(
      classifyCliFailure('adb run-as cat', path, `cat: ${path}: No such file or directory`, 1).code,
    ).toBe('NOT_FOUND')
  })

  it('maps a MISSING file whose path contains "device not found" to NOT_FOUND', () => {
    const path = '/sdcard/reports/device not found.txt'
    expect(
      classifyCliFailure('adb run-as cat', path, `cat: ${path}: No such file or directory`, 1).code,
    ).toBe('NOT_FOUND')
  })

  it('does NOT map a NON-missing failure to NOT_FOUND when the path contains "no such file"', () => {
    // The real error is EISDIR/EACCES, not ENOENT — the caller-controlled path
    // must not steer classification into the NOT_FOUND bucket (path is masked).
    const path = '/data/data/com.acme.app/files/no such file.txt'
    expect(classifyCliFailure('adb run-as cat', path, `cat: ${path}: Is a directory`, 1).code).toBe(
      'TRANSPORT_FAILED',
    )
    expect(
      classifyCliFailure('adb run-as cat', path, `cat: ${path}: Permission denied`, 1).code,
    ).toBe('TRANSPORT_FAILED')
  })

  it('still maps a genuinely missing file to NOT_FOUND even when the path also contains "no such file"', () => {
    const path = '/data/data/com.acme.app/files/no such file.txt'
    expect(
      classifyCliFailure('adb run-as cat', path, `cat: ${path}: No such file or directory`, 1).code,
    ).toBe('NOT_FOUND')
  })

  it('keeps run-as debuggable failures as UNSUPPORTED (precedence over the bare not-found)', () => {
    expect(
      classifyCliFailure('adb', '/sdcard/x', 'run-as: package not found: com.acme.app', 1).code,
    ).toBe('UNSUPPORTED')
  })

  it('falls back to TRANSPORT_FAILED for an unclassified nonzero exit', () => {
    expect(classifyCliFailure('adb', '/sdcard/x', 'some other failure', 1).code).toBe(
      'TRANSPORT_FAILED',
    )
  })
})
