import { describe, expect, it } from 'vitest'
import {
  ConfigNotFoundError,
  loadConfig,
  readProjectContext,
  resolveProjectRoot,
} from './load-config'
import { ConfigValidationError } from './validate'

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

const failWith = (code: string) => (): Promise<string> =>
  Promise.reject(Object.assign(new Error(code), { code }))
const readText = (text: string) => (): Promise<string> => Promise.resolve(text)

describe('readProjectContext (REQ-CFG-006)', () => {
  it('returns undefined when the project has no package.json', async () => {
    expect(await readProjectContext('/proj', failWith('ENOENT'))).toBeUndefined()
  })

  it('names dependencies and devDependencies from the package next to the config', async () => {
    const read = readText(
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
    await expect(readProjectContext('/proj', readText('{ not json'))).rejects.toThrow(
      '/proj/package.json: ',
    )
  })

  it('propagates read failures other than a missing file', async () => {
    await expect(readProjectContext('/proj', failWith('EACCES'))).rejects.toThrow('EACCES')
  })
})

const onlyDirectory =
  (dir: string) =>
  (p: string): boolean =>
    p === dir

describe('resolveProjectRoot (REQ-CFG-007)', () => {
  const configPath = '/repo/apps/app-e2e/rn-driver.config.mjs'

  it('is the config directory when projectRoot is unset', () => {
    expect(resolveProjectRoot(configPath, {}, () => false)).toBe('/repo/apps/app-e2e')
  })

  it('resolves projectRoot against the config directory', () => {
    const isDirectory = onlyDirectory('/repo/apps/app')
    expect(resolveProjectRoot(configPath, { projectRoot: '../app' }, isDirectory)).toBe(
      '/repo/apps/app',
    )
  })

  it('refuses a projectRoot that is not a directory, naming the resolved path', () => {
    expect(() =>
      resolveProjectRoot(configPath, { projectRoot: '../missing' }, () => false),
    ).toThrow(ConfigValidationError)
    expect(() =>
      resolveProjectRoot(configPath, { projectRoot: '../missing' }, () => false),
    ).toThrow('config.projectRoot: /repo/apps/missing is not a directory')
  })

  it('leaves a mistyped projectRoot to validation', () => {
    expect(resolveProjectRoot(configPath, { projectRoot: 42 }, () => false)).toBe(
      '/repo/apps/app-e2e',
    )
  })
})
