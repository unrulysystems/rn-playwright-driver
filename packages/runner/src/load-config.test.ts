import { describe, expect, it } from 'vitest'
import { ConfigNotFoundError, loadConfig, readProjectContext } from './load-config'

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

describe('readProjectContext (REQ-CFG-006)', () => {
  const enoent = (): Promise<string> =>
    Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

  it('returns undefined when the project has no package.json', async () => {
    expect(await readProjectContext('/proj', enoent)).toBeUndefined()
  })

  it('names dependencies and devDependencies from the package next to the config', async () => {
    const read = (): Promise<string> =>
      Promise.resolve(
        JSON.stringify({
          dependencies: { expo: '1', 'expo-dev-client': '1' },
          devDependencies: { vitest: '1' },
        }),
      )
    expect(await readProjectContext('/proj', read)).toEqual({
      packageJsonPath: '/proj/package.json',
      dependencies: ['expo', 'expo-dev-client', 'vitest'],
    })
  })

  it('reports an unreadable package.json by path instead of ignoring it', async () => {
    const read = (): Promise<string> => Promise.resolve('{ not json')
    await expect(readProjectContext('/proj', read)).rejects.toThrow('/proj/package.json: ')
  })

  it('propagates read failures other than a missing file', async () => {
    const read = (): Promise<string> =>
      Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' }))
    await expect(readProjectContext('/proj', read)).rejects.toThrow('EACCES')
  })
})
