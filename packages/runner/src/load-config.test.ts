import { describe, expect, it } from 'vitest'
import { ConfigNotFoundError, loadConfig } from './load-config'

describe('loadConfig', () => {
  it('loads an explicit config path and extracts the default export', async () => {
    const config = { ios: {} }
    const result = await loadConfig({
      cwd: '/proj',
      configPath: 'rn-driver.config.ts',
      importer: () => Promise.resolve({ default: config }),
      fileExists: () => true,
    })
    expect(result.config).toBe(config)
    expect(result.path).toBe('/proj/rn-driver.config.ts')
  })

  it('searches upward from the cwd for a default config name', async () => {
    const result = await loadConfig({
      cwd: '/a/b/c',
      importer: () => Promise.resolve({ default: { ok: true } }),
      fileExists: (p) => p === '/a/rn-driver.config.ts',
    })
    expect(result.path).toBe('/a/rn-driver.config.ts')
  })

  it('throws ConfigNotFoundError when nothing is found', async () => {
    await expect(
      loadConfig({ cwd: '/x/y', importer: () => Promise.resolve({}), fileExists: () => false }),
    ).rejects.toBeInstanceOf(ConfigNotFoundError)
  })

  it('returns the namespace when there is no default export', async () => {
    const namespace = { foo: 1 }
    const result = await loadConfig({
      cwd: '/p',
      configPath: 'c.mjs',
      importer: () => Promise.resolve(namespace),
      fileExists: () => true,
    })
    expect(result.config).toBe(namespace)
  })
})
