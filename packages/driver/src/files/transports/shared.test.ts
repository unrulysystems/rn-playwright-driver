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
