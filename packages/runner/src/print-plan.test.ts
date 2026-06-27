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
    expect(text).toContain('npx playwright test')
    expect(text).toContain('Cleanup (defensive, idempotent):')
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
