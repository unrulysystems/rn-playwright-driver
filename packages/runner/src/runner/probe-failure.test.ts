import { describe, expect, it } from 'vitest'
import { COMPANION_FAILURE_MARKERS } from '../constants'
import { findFailureMarker, ProbeFailure } from './probe-failure'

describe('findFailureMarker', () => {
  it('returns the first marker present in the log', () => {
    const log =
      'Compiling…\nPhaseScriptExecution\n** BUILD FAILED **\n\nThe following build commands failed:'
    expect(findFailureMarker(log, COMPANION_FAILURE_MARKERS.ios)).toBe('** BUILD FAILED **')
  })

  it('matches `** TEST FAILED **` too', () => {
    expect(findFailureMarker('Testing…\n** TEST FAILED **', COMPANION_FAILURE_MARKERS.ios)).toBe(
      '** TEST FAILED **',
    )
  })

  it('matches the Android am-instrument failure markers', () => {
    expect(
      findFailureMarker(
        'INSTRUMENTATION_STATUS_CODE: -1\nINSTRUMENTATION_FAILED: com.bos.boss.test/…',
        COMPANION_FAILURE_MARKERS.android,
      ),
    ).toBe('INSTRUMENTATION_FAILED')
    expect(findFailureMarker('Process crashed.', COMPANION_FAILURE_MARKERS.android)).toBe(
      'Process crashed',
    )
  })

  it('returns null when no marker is present (a still-building log is not a failure)', () => {
    const log = 'Testing…\nTest Suite RNDriverTouchCompanionTests started\nlistening on 9999'
    expect(findFailureMarker(log, COMPANION_FAILURE_MARKERS.ios)).toBeNull()
  })

  it('returns null for an empty log (process just spawned, nothing written yet)', () => {
    expect(findFailureMarker('', COMPANION_FAILURE_MARKERS.ios)).toBeNull()
  })

  it('returns the FIRST listed marker when several appear', () => {
    // `findFailureMarker` scans in marker order; ios lists BUILD before TEST.
    const log = '** TEST FAILED **\n…\n** BUILD FAILED **'
    expect(findFailureMarker(log, COMPANION_FAILURE_MARKERS.ios)).toBe('** BUILD FAILED **')
  })
})

describe('ProbeFailure', () => {
  it('carries the marker and embeds it + the detail in the message', () => {
    const err = new ProbeFailure('** BUILD FAILED **', 'node: No such file or directory')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ProbeFailure')
    expect(err.marker).toBe('** BUILD FAILED **')
    expect(err.message).toContain('** BUILD FAILED **')
    expect(err.message).toContain('node: No such file or directory')
  })

  it('omits the detail block when there is no detail', () => {
    const err = new ProbeFailure('** TEST FAILED **', '')
    expect(err.message).toContain('** TEST FAILED **')
    expect(err.message.trimEnd().endsWith('ready.')).toBe(true)
  })
})
