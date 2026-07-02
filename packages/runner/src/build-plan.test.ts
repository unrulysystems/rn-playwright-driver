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
})
