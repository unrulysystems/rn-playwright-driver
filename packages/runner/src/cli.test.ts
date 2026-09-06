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

const INVALID_HOOK_CONFIG_SRC = `export default {
  metro: { command: 'echo metro', port: 8099 },
  ios: {
    bundleId: 'com.example.app',
    workspace: 'ios/App.xcworkspace',
    appScheme: 'App',
    launch: { mode: 'launch', kind: 'plain' },
  },
  hooks: {
    configureTarget: () => ({ env: { playwright: { API_TOKEN: 'inline-secret' } } }),
  },
}
`

describe('run() --dry-run (REQ-CLI-002)', () => {
  let configPath: string
  let stdout: string
  let stderr: string

  beforeEach(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'rn-driver-cli-test-'))
    configPath = path.join(dir, 'rn-driver.config.mjs')
    await writeFile(configPath, CONFIG_SRC)
    stdout = ''
    stderr = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
      stdout += String(chunk)
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
      stderr += String(chunk)
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
    expect(stdout).toContain(`(cwd: ${path.dirname(configPath)})`)
  })

  it('says the device is unresolved when --device is given, so a typo does not read as a passing pre-flight', async () => {
    const code = await run([
      'test',
      '--platform',
      'ios',
      '--config',
      configPath,
      '--device',
      'no-such-simulator-xyz',
      '--dry-run',
    ])
    // REQ-CLI-002 forbids device I/O here, so exit 0 is correct — but the output
    // must not let the caller believe the device was checked. Without the notice
    // this run is byte-identical to one naming a real device.
    expect(code).toBe(0)
    expect(stdout).toContain('does not resolve or validate --device no-such-simulator-xyz')
    expect(stdout).toContain('fails at stage [device]')
    expect(stdout).toContain('<sim-udid>')
  })

  it('prints no such note when --device is absent', async () => {
    const code = await run(['test', '--platform', 'ios', '--config', configPath, '--dry-run'])
    expect(code).toBe(0)
    expect(stdout).not.toContain('does not resolve or validate')
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

  it('rejects a plain launch kind when the app package installs expo-dev-client (REQ-CFG-006)', async () => {
    const packageJsonPath = path.join(path.dirname(configPath), 'package.json')
    await writeFile(
      packageJsonPath,
      JSON.stringify({
        name: 'app',
        dependencies: { expo: '~56.0.0', 'expo-dev-client': '~56.0.0' },
      }),
    )
    const code = await run(['test', '--platform', 'ios', '--config', configPath, '--dry-run'])
    expect(code).toBe(2)
    expect(stderr).toContain(
      `config.ios.launch.kind: "plain" but expo-dev-client is a dependency in ${packageJsonPath}`,
    )
    expect(stdout).not.toContain('Plan (ios)')
  })

  it('reports dry-run hook validation failures as config-stage failures', async () => {
    await writeFile(configPath, INVALID_HOOK_CONFIG_SRC)
    const code = await run(['test', '--platform', 'ios', '--config', configPath, '--dry-run'])

    expect(code).toBe(10)
    expect(stderr).toContain('FAILED at stage [config]')
    expect(stderr).toContain('API_TOKEN')
    expect(stderr).not.toContain('TargetHookError')
  })
})

describe('run() runtime preflight (REQ-CLI-008)', () => {
  let configPath: string
  let stderr: string

  beforeEach(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'rn-driver-cli-runtime-'))
    configPath = path.join(dir, 'rn-driver.config.mjs')
    await writeFile(configPath, CONFIG_SRC)
    stderr = ''
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
      stderr += String(chunk)
      return true
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('refuses a runtime without global WebSocket at the config stage before any effectful step', async () => {
    vi.stubGlobal('WebSocket', undefined)
    const code = await run(['test', '--platform', 'ios', '--config', configPath])
    expect(code).toBe(10)
    expect(stderr).toContain('FAILED at stage [config] runtime:')
    expect(stderr).toContain('Node >= 22 or bun')
  })

  it('still prints the dry-run plan on such a runtime (REQ-CLI-002)', async () => {
    vi.stubGlobal('WebSocket', undefined)
    const code = await run(['test', '--platform', 'ios', '--dry-run', '--config', configPath])
    expect(code).toBe(0)
    expect(stderr).toBe('')
  })
})
