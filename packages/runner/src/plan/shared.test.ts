import { describe, expect, it } from 'vitest'
import { metroStartStep, packageBin, playwrightCommand, projectPath } from './shared'

const PW = { config: 'playwright.config.ts', specs: ['e2e/a.spec.ts', 'e2e/b'] }

describe('packageBin', () => {
  it('keeps package-bin commands symbolic so planning stays pure', () => {
    expect(packageBin('expo', ['start'], '/app')).toEqual({
      command: 'expo',
      args: ['start'],
      cwd: '/app',
      packageBin: true,
    })
  })
})

describe('projectPath', () => {
  it('resolves project-relative paths and leaves absolute/placeholders untouched', () => {
    expect(projectPath('/app', 'android/app.apk')).toBe('/app/android/app.apk')
    expect(projectPath('/app', '/tmp/app.apk')).toBe('/tmp/app.apk')
    expect(projectPath('/app', '<token-file>')).toBe('<token-file>')
    expect(projectPath(undefined, 'android/app.apk')).toBe('android/app.apk')
  })
})

describe('metroStartStep', () => {
  it('uses a hoist-safe Expo package bin with non-interactive env when no custom command is set', () => {
    expect(
      metroStartStep({
        url: 'http://localhost:8083',
        host: 'localhost',
        port: 8083,
        command: undefined,
        reuseExisting: false,
        readyTimeoutMs: 90_000,
      }).action,
    ).toMatchObject({
      type: 'command',
      command: {
        command: 'expo',
        args: ['start', '--localhost', '--port', '8083'],
        packageBin: true,
        env: { CI: '1', EXPO_NO_TELEMETRY: '1' },
      },
    })
  })
})

describe('playwrightCommand (REQ-CLI-005)', () => {
  it('uses the config spec list when no positional specs are given', () => {
    const cmd = playwrightCommand(PW, [], [], '/app')

    expect(cmd.command).toBe('playwright')
    expect(cmd.cwd).toBe('/app')
    expect(cmd.packageBin).toBe(true)
    expect(cmd.args).toEqual([
      'test',
      '--config',
      'playwright.config.ts',
      'e2e/a.spec.ts',
      'e2e/b',
      '--reporter=line',
    ])
  })

  it('positional specs override the config spec list', () => {
    const cmd = playwrightCommand(PW, ['e2e/only.spec.ts'], [])
    expect(cmd.args).toContain('e2e/only.spec.ts')
    expect(cmd.args).not.toContain('e2e/a.spec.ts')
  })

  it('REGRESSION: a passthrough-only call keeps the config specs AND appends passthrough', () => {
    const cmd = playwrightCommand(PW, [], ['--grep', '@smoke'])
    // Config specs are NOT dropped just because passthrough flags were supplied.
    expect(cmd.args).toEqual(expect.arrayContaining(['e2e/a.spec.ts', 'e2e/b']))
    expect(cmd.args.join(' ')).toContain('--grep @smoke')
  })

  it('combines positional specs with passthrough flags', () => {
    const cmd = playwrightCommand(PW, ['e2e/only.spec.ts'], ['--workers', '1'])
    expect(cmd.args).toContain('e2e/only.spec.ts')
    expect(cmd.args).not.toContain('e2e/a.spec.ts')
    expect(cmd.args.join(' ')).toContain('--workers 1')
  })
})
