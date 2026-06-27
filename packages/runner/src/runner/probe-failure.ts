/**
 * Early-abort signal for a readiness probe whose backing companion process has TERMINALLY failed
 * (its build or test reported failure) and will never become ready. Without it the companion-ready
 * probe waits out the full cold-build timeout (300s for iOS) even though `xcodebuild test` already
 * printed `** BUILD FAILED **` — the failed process lingers "alive" doing reporting, so the
 * `isAlive` gate does not trip promptly. The probe scans the process's captured log for a terminal
 * marker (see COMPANION_FAILURE_MARKERS) and throws this; the executor wraps it as a StageError so
 * the run fails fast with the ACTUAL build error instead of an opaque readiness timeout.
 */
export class ProbeFailure extends Error {
  readonly marker: string

  constructor(marker: string, detail: string) {
    super(
      `companion process reported a terminal failure ("${marker}") — aborting the readiness wait. ` +
        `The build/test failed; it will not become ready.${detail ? `\n${detail}` : ''}`,
    )
    this.name = 'ProbeFailure'
    this.marker = marker
  }
}

/**
 * Return the first failure marker present in `log`, or null if none. Pure (no I/O) so the scan is
 * unit-testable without spawning a process; the OS read of the log file lives in the ProcessRunner.
 */
export function findFailureMarker(log: string, markers: readonly string[]): string | null {
  for (const marker of markers) {
    if (log.includes(marker)) return marker
  }
  return null
}
