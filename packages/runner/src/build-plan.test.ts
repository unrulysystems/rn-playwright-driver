import { describe, expect, it } from 'vitest'
import { buildDryRunPlan } from './build-plan'
import { configFixture } from './fixtures'
import { renderPlan } from './print-plan'

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

  it('passes target facts to configureTarget and inserts project-owned steps/env/cleanup', () => {
    const seen: unknown[] = []
    const plan = buildDryRunPlan(
      configFixture({
        hooks: {
          configureTarget: (target) => {
            seen.push(target)
            return {
              env: {
                metro: { EXPO_PUBLIC_E2E_TARGET: `${target.platform}:${target.kind}` },
                playwright: { E2E_TARGET_ID: target.id },
              },
              steps: {
                beforeMetro: [
                  {
                    id: 'example.before-metro',
                    description: 'Configure project network before Metro',
                    command: { command: 'node', args: ['scripts/e2e-network.mjs', target.kind] },
                  },
                ],
                afterMetroReady: [
                  {
                    id: 'example.after-metro',
                    description: 'Verify project network after Metro',
                    command: { command: 'node', args: ['scripts/check-network.mjs'] },
                  },
                ],
                beforeLaunch: [
                  {
                    id: 'example.before-launch',
                    description: 'Prepare app-owned service routing',
                    stage: 'device',
                    command: { command: 'node', args: ['scripts/route-services.mjs'] },
                  },
                ],
              },
              cleanup: [
                {
                  description: 'Remove project-owned service routing',
                  command: { command: 'node', args: ['scripts/e2e-network-cleanup.mjs'] },
                },
              ],
            }
          },
        },
      }),
      'ios',
      { projectCwd: '/app' },
    )

    expect(seen).toEqual([
      {
        platform: 'ios',
        kind: 'simulator',
        id: '<sim-udid>',
        deviceName: '<sim-name>',
        appId: 'com.unrulyfall.example',
        metroUrl: 'http://127.0.0.1:8081',
      },
    ])
    const ids = plan.steps.map((step) => step.id)
    expect(ids.indexOf('example.before-metro')).toBeLessThan(ids.indexOf('metro.start'))
    expect(ids.indexOf('example.after-metro')).toBeGreaterThan(ids.indexOf('metro.ready'))
    expect(ids.indexOf('example.before-launch')).toBeLessThan(ids.indexOf('ios.companion-start'))
    expect(plan.steps.find((step) => step.id === 'example.before-launch')?.stage).toBe('device')
    expect(plan.steps.find((step) => step.id === 'metro.start')?.action).toMatchObject({
      type: 'command',
      command: { env: { EXPO_PUBLIC_E2E_TARGET: 'ios:simulator' } },
    })
    expect(plan.playwright.env).toMatchObject({ E2E_TARGET_ID: '<sim-udid>' })
    expect(plan.cleanup[0]).toMatchObject({
      type: 'command',
      description: 'Remove project-owned service routing',
    })

    const rendered = renderPlan(plan)
    expect(rendered).toContain('example.before-metro')
    expect(rendered).toContain('EXPO_PUBLIC_E2E_TARGET=ios:simulator')
    expect(rendered).toContain('E2E_TARGET_ID=<sim-udid>')
    expect(rendered).toContain('Remove project-owned service routing')
  })

  it('reports Android emulator target facts in dry-run', () => {
    const seen: unknown[] = []
    buildDryRunPlan(
      configFixture({
        hooks: {
          configureTarget: (target) => {
            seen.push(target)
            return {}
          },
        },
      }),
      'android',
    )

    expect(seen).toEqual([
      {
        platform: 'android',
        kind: 'emulator',
        id: '<android-serial>',
        deviceName: '<android-device>',
        appId: 'com.unrulyfall.example',
        metroUrl: 'http://127.0.0.1:8081',
      },
    ])
  })

  it('rejects hook env that looks like an inline secret', () => {
    expect(() =>
      buildDryRunPlan(
        configFixture({
          hooks: {
            configureTarget: () => ({
              env: { playwright: { API_TOKEN: 'inline-secret' } },
            }),
          },
        }),
        'ios',
      ),
    ).toThrow('API_TOKEN')
  })
})
