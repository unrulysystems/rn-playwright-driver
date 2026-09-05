import { describe, expect, it } from 'vitest'
import { buildDryRunPlan } from './build-plan'
import { configFixture, iosDevClientConfigFixture } from './fixtures'
import { renderPlan } from './print-plan'

describe('renderPlan', () => {
  it('renders the platform header, steps, env, playwright, and cleanup', () => {
    const text = renderPlan(buildDryRunPlan(configFixture(), 'ios'))
    expect(text).toContain('Plan (ios)')
    expect(text).toContain('ios.companion-start')
    expect(text).toContain('Driver env (handed to Playwright):')
    expect(text).toContain('RN_TOUCH_BACKEND=xctest')
    expect(text).toContain('Playwright:')
    expect(text).toContain('playwright test')
    expect(text).toContain('[package-bin]')
    expect(text).toContain('Cleanup (defensive, idempotent):')
  })

  it('renders the install step with the resolved target so the dry run shows who installs the app (REQ-IOS-015)', () => {
    const text = renderPlan(buildDryRunPlan(configFixture(), 'ios'))
    expect(text).toContain('ios.install-app')
    expect(text).toContain('install-ios-app example -> simulator <sim-udid>')
  })

  it('renders the app-container seeds with their keys and typed values so the dry run shows what the app will read (REQ-IOS-005, REQ-IOS-016)', () => {
    const text = renderPlan(
      buildDryRunPlan(configFixture({ ios: iosDevClientConfigFixture() }), 'ios'),
    )
    expect(text).toContain('ios.packager-host')
    expect(text).toContain(
      'seed-ios-defaults com.unrulyfall.example on <sim-udid>: RCT_jsLocation=127.0.0.1:8081 RCT_packager_scheme=http  (app-container plist)',
    )
    expect(text).toContain(
      'seed-ios-defaults com.unrulyfall.example on <sim-udid>: EXDevMenuIsOnboardingFinished=true EXDevMenuShowsAtLaunch=false EXDevMenuShowFloatingActionButton=false  (app-container plist)',
    )
  })

  it('renders appended env as KEY+=value so the dry run shows the Metro loopback binding (REQ-METRO-005)', () => {
    const text = renderPlan(buildDryRunPlan(configFixture(), 'ios'))
    expect(text).toContain('NODE_OPTIONS+=--dns-result-order=ipv4first')
  })

  it('shows the dev-client --initialUrl launch and marks skippable steps', () => {
    const text = renderPlan(
      buildDryRunPlan(configFixture({ ios: iosDevClientConfigFixture() }), 'ios'),
    )
    expect(text).toContain('--initialUrl')
    expect(text).toContain('(skip-build: skipped)')
  })

  it('renders the companion-ready fast-fail markers so dry-run stays faithful (REQ-CLI-002)', () => {
    // The probe aborts EARLY on a terminal build/test marker; an auditable plan must surface that.
    const ios = renderPlan(buildDryRunPlan(configFixture(), 'ios'))
    expect(ios).toMatch(/probe xctest-hello .*\[fast-fail on: .*\*\* BUILD FAILED \*\*.*\]/)
    expect(ios).toContain('** TEST FAILED **')

    const android = renderPlan(buildDryRunPlan(configFixture(), 'android'))
    expect(android).toMatch(
      /probe instrumentation-hello .*\[fast-fail on: .*INSTRUMENTATION_FAILED.*\]/,
    )
    expect(android).toContain('Process crashed')
  })

  it('never prints a secret value — only the placeholder token-file path', () => {
    const text = renderPlan(buildDryRunPlan(configFixture(), 'android'))
    expect(text).toContain('<token-file>')
    expect(text).not.toMatch(/authToken[^F]/) // no `authToken` followed by a value (only authTokenFile)
  })
})
