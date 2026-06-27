import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run } from './cli'

// A valid config written to a temp .mjs so run() loads it via the default dynamic
// importer (the real CLI path), not an injected stub.
const CONFIG_SRC = `export default {
  metro: { command: 'echo metro', port: 8099 },
  ios: {
    bundleId: 'com.example.app',
    workspace: 'ios/App.xcworkspace',
    appScheme: 'App',
    launch: { mode: 'launch', kind: 'plain' },
  },
  playwright: { config: 'playwright.config.ts', specs: ['e2e/x.spec.ts'] },
}
`

describe('run() --dry-run (REQ-CLI-002)', () => {
  let configPath: string
  let stdout: string

  beforeEach(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'rn-driver-cli-test-'))
    configPath = path.join(dir, 'rn-driver.config.mjs')
    await writeFile(configPath, CONFIG_SRC)
    stdout = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
      stdout += String(chunk)
      return true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prints a placeholder plan and exits 0 without resolving a real device', async () => {
    const code = await run(['test', '--platform', 'ios', '--config', configPath, '--dry-run'])
    expect(code).toBe(0)
    expect(stdout).toContain('Plan (ios)')
    // Placeholders prove the no-I/O path ran: a real run would resolve a concrete
    // simulator udid and mint a real token file. Their presence means device
    // resolution / token minting did NOT happen.
    expect(stdout).toContain('<sim-udid>')
    expect(stdout).toContain('<token-file>')
  })

  it('forwards passthrough flags while keeping config specs (REQ-CLI-005)', async () => {
    const code = await run([
      'test',
      '--platform',
      'ios',
      '--config',
      configPath,
      '--dry-run',
      '--',
      '--grep',
      '@smoke',
    ])
    expect(code).toBe(0)
    // The configured spec survives a passthrough-only invocation, and the
    // passthrough flag is appended.
    expect(stdout).toContain('e2e/x.spec.ts')
    expect(stdout).toContain('--grep @smoke')
  })
})
