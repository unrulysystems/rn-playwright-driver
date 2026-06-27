import { describe, expect, it } from 'vitest'
import { androidConfigFixture, androidDevClientConfigFixture } from '../fixtures'
import { planAndroid, type PlanAndroidInput } from './android'
import { placeholderAndroid, resolveMetro } from './resolved'
import type { CommandSpec, Plan } from './types'

function inputFor(overrides: Partial<PlanAndroidInput> = {}): PlanAndroidInput {
  const android = overrides.android ?? androidConfigFixture()
  const metro = resolveMetro({ command: 'npx expo start' })
  return {
    android,
    metro,
    resolved: placeholderAndroid(android, metro),
    playwright: { config: 'playwright.config.ts' },
    timeoutMs: undefined,
    specs: [],
    passthrough: [],
    hermesDeviceName: '<android-device>',
    ...overrides,
  }
}

const stepIds = (plan: Plan): string[] => plan.steps.map((s) => s.id)

function commandFor(plan: Plan, id: string): CommandSpec {
  const action = plan.steps.find((s) => s.id === id)?.action
  if (action?.type !== 'command') throw new Error(`expected ${id} to be a command step`)
  return action.command
}

describe('planAndroid', () => {
  it('produces the Android lifecycle stages in order', () => {
    expect(stepIds(planAndroid(inputFor()))).toEqual([
      'android.prebuild',
      'android.gradle',
      'android.install-app',
      'android.install-test',
      'android.install-token',
      'metro.start',
      'metro.ready',
      'android.reverse-metro',
      'android.debug-host',
      'android.launch-1',
      'android.hermes-1',
      'android.forward-clean',
      'android.forward',
      'android.instrument-start',
      'android.instrument-ready',
      'android.launch-2',
      'android.hermes-2',
    ])
  })

  it('REQ-AND-006: installs the token via stdin and instruments via rnDriverAuthTokenFile (never inline)', () => {
    const plan = planAndroid(inputFor())
    const install = plan.steps.find((s) => s.id === 'android.install-token')?.action
    expect(install?.type === 'command' && install.command.stdinFromFile).toBe('<token-file>')
    // The token value is never an argv element of the install command.
    expect(install?.type === 'command' && install.command.args).not.toContain('<token-file>')

    const instrument = plan.steps.find((s) => s.id === 'android.instrument-start')?.action
    const args = instrument?.type === 'command' ? instrument.command.args : []
    expect(args).toContain('rnDriverAuthTokenFile')
    expect(args).not.toContain('rnDriverAuthToken') // not the inline form
    // The device-private filename is referenced, not a token value.
    expect(args).toContain('rn-driver-touch-token')
  })

  it('REQ-AND: run-as redirect steps send the whole sh -c script as a single adb arg', () => {
    // Regression: passing `sh -c <script>` as separate adb args lets `adb shell`
    // re-split them, so the device's OUTER shell (uid `shell`, cwd `/`) performs
    // the `>` redirect instead of the run-as'd app-uid shell — the write fails
    // with "can't create files/…: No such file or directory". The whole remote
    // command must be one arg with literal inner single-quotes.
    const plan = planAndroid(inputFor())
    for (const id of ['android.install-token', 'android.debug-host']) {
      const action = plan.steps.find((s) => s.id === id)?.action
      const args = action?.type === 'command' ? action.command.args : []
      // adb invocation is exactly: -s <serial> shell <single-remote-script>
      expect(args.slice(0, 3)).toEqual(['-s', '<android-serial>', 'shell'])
      expect(args).toHaveLength(4)
      const remote = args[3] ?? ''
      // The script is grouped for the inner shell via single quotes around sh -c.
      expect(remote).toMatch(/^run-as \S+ sh -c '.*'$/)
      expect(remote).toContain('cat >')
      // `sh` and `-c` are NOT standalone argv elements (the split-arg bug).
      expect(args).not.toContain('-c')
    }
  })

  it('emits the driver env contract with a token FILE and the adb serial, never an inline token', () => {
    const plan = planAndroid(inputFor())
    expect(plan.driverEnv).toMatchObject({
      RN_TOUCH_BACKEND: 'instrumentation',
      RN_TOUCH_INSTRUMENTATION_TOKEN_FILE: '<token-file>',
      ANDROID_SERIAL: '<android-serial>',
    })
    expect(plan.driverEnv).not.toHaveProperty('RN_TOUCH_INSTRUMENTATION_TOKEN')
  })

  it('cleanup removes adb mappings, the device token file, and force-stops the app', () => {
    const plan = planAndroid(inputFor())
    const cleanupCmds = plan.cleanup.flatMap((c) =>
      c.type === 'command' ? [c.command.args.join(' ')] : [],
    )
    expect(cleanupCmds.some((c) => c.includes('reverse --remove'))).toBe(true)
    expect(cleanupCmds.some((c) => c.includes('forward --remove'))).toBe(true)
    expect(cleanupCmds.some((c) => c.includes('rm -f files/rn-driver-touch-token'))).toBe(true)
    expect(cleanupCmds.some((c) => c.includes('force-stop'))).toBe(true)
    expect(plan.cleanup).toContainEqual(
      expect.objectContaining({ type: 'remove-file', path: '<token-file>' }),
    )
  })

  it('adds a default-port reverse only when Metro is off 8081, and cleans BOTH up', () => {
    const onDefault = planAndroid(inputFor())
    expect(stepIds(onDefault)).not.toContain('android.reverse-default')
    const onDefaultCleanup = onDefault.cleanup.flatMap((c) =>
      c.type === 'command' ? [c.command.args.join(' ')] : [],
    )
    // On default 8081 there is exactly one reverse --remove (no fallback).
    expect(onDefaultCleanup.filter((c) => c.includes('reverse --remove'))).toHaveLength(1)

    const metro = resolveMetro({ url: 'http://127.0.0.1:8088' })
    const offDefault = planAndroid(
      inputFor({ metro, resolved: placeholderAndroid(androidConfigFixture(), metro) }),
    )
    expect(stepIds(offDefault)).toContain('android.reverse-default')
    const offDefaultCleanup = offDefault.cleanup.flatMap((c) =>
      c.type === 'command' ? [c.command.args.join(' ')] : [],
    )
    // REQ-CLEAN-003: both the 8088 reverse AND the fallback 8081 reverse are removed.
    expect(offDefaultCleanup.some((c) => c.includes('reverse --remove tcp:8088'))).toBe(true)
    expect(offDefaultCleanup.some((c) => c.includes('reverse --remove tcp:8081'))).toBe(true)
  })

  it('REQ-AND-005: both Hermes waits carry a bounded am-start retry', () => {
    const plan = planAndroid(inputFor())
    for (const id of ['android.hermes-1', 'android.hermes-2']) {
      const action = plan.steps.find((s) => s.id === id)?.action
      expect(action?.type).toBe('probe')
      if (action?.type === 'probe') {
        expect(action.retry?.max).toBeGreaterThan(0)
        expect(action.retry?.command.args.join(' ')).toContain('am start')
      }
    }
  })

  it('plain launch remains activity-based', () => {
    const plan = planAndroid(inputFor())
    expect(commandFor(plan, 'android.launch-1').args).toEqual([
      '-s',
      '<android-serial>',
      'shell',
      'am',
      'start',
      '-W',
      '-n',
      'com.unrulyfall.example/.MainActivity',
    ])
  })

  it('dev-client launch uses one adb shell arg with a literally single-quoted URL', () => {
    const android = androidDevClientConfigFixture()
    const plan = planAndroid(
      inputFor({ android, resolved: placeholderAndroid(android, resolveMetro(undefined)) }),
    )
    const args = commandFor(plan, 'android.launch-1').args
    expect(args.slice(0, 3)).toEqual(['-s', '<android-serial>', 'shell'])
    expect(args).toHaveLength(4)
    const remote = args[3] ?? ''
    expect(remote).toContain("-d 'boss://expo-development-client/?url=http://127.0.0.1:8081'")
  })

  it('dev-client launch-1 force-stops before deep-linking, but launch-2 does not', () => {
    const android = androidDevClientConfigFixture()
    const plan = planAndroid(
      inputFor({ android, resolved: placeholderAndroid(android, resolveMetro(undefined)) }),
    )
    const launch1 = commandFor(plan, 'android.launch-1').args[3] ?? ''
    const launch2 = commandFor(plan, 'android.launch-2').args[3] ?? ''
    expect(launch1).toContain('am force-stop com.unrulyfall.example && am start')
    expect(launch1).toContain('android.intent.action.VIEW')
    expect(launch2).not.toContain('force-stop')
    expect(launch2).toContain('am start -a android.intent.action.VIEW')
  })

  it('dev-client Hermes retries reissue the deep link', () => {
    const android = androidDevClientConfigFixture()
    const plan = planAndroid(
      inputFor({ android, resolved: placeholderAndroid(android, resolveMetro(undefined)) }),
    )
    for (const id of ['android.hermes-1', 'android.hermes-2']) {
      const action = plan.steps.find((s) => s.id === id)?.action
      expect(action?.type).toBe('probe')
      if (action?.type === 'probe') {
        expect(action.retry?.command.args).toHaveLength(4)
        expect(action.retry?.command.args[3]).toContain('android.intent.action.VIEW')
        expect(action.retry?.command.args[3]).toContain(
          "'boss://expo-development-client/?url=http://127.0.0.1:8081'",
        )
      }
    }
  })

  it('is pure: identical input yields a deep-equal plan', () => {
    expect(planAndroid(inputFor())).toEqual(planAndroid(inputFor()))
  })
})
