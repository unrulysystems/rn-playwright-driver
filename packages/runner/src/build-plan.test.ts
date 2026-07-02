import { describe, expect, it } from 'vitest'
import { buildDryRunPlan } from './build-plan'
import { configFixture } from './fixtures'

describe('buildDryRunPlan', () => {
  it('threads the project cwd into project-bound package-bin and shell commands', () => {
    const plan = buildDryRunPlan(configFixture(), 'ios', { projectCwd: '/app' })

    const prebuild = plan.steps.find((step) => step.id === 'ios.prebuild')
    const metro = plan.steps.find((step) => step.id === 'metro.start')

    expect(prebuild?.action).toMatchObject({
      type: 'command',
      command: { command: 'expo', packageBin: true, cwd: '/app' },
    })
    expect(metro?.action).toMatchObject({
      type: 'command',
      command: { command: 'sh', cwd: '/app' },
    })
    expect(plan.playwright).toMatchObject({
      command: 'playwright',
      packageBin: true,
      cwd: '/app',
    })
  })

  it('uses the default Expo package-bin Metro start when no custom command is configured', () => {
    const plan = buildDryRunPlan(
      configFixture({ metro: { host: 'localhost', port: 8083 } }),
      'ios',
      {
        projectCwd: '/app',
      },
    )

    const metro = plan.steps.find((step) => step.id === 'metro.start')
    expect(metro?.action).toMatchObject({
      type: 'command',
      command: {
        command: 'expo',
        args: ['start', '--localhost', '--port', '8083'],
        packageBin: true,
        cwd: '/app',
        env: { CI: '1', EXPO_NO_TELEMETRY: '1' },
      },
    })
  })
})
