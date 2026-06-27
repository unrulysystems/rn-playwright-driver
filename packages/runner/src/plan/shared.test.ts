import { describe, expect, it } from 'vitest'
import { playwrightCommand } from './shared'

const PW = { config: 'playwright.config.ts', specs: ['e2e/a.spec.ts', 'e2e/b'] }

describe('playwrightCommand (REQ-CLI-005)', () => {
  it('uses the config spec list when no positional specs are given', () => {
    const cmd = playwrightCommand(PW, [], [])
    expect(cmd.args).toEqual([
      'playwright',
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
