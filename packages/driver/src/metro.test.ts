import { describe, expect, it, vi } from 'vitest'

import {
  E2E_ENTRY_RELATIVE,
  type EntryFileIo,
  type ExpoPaths,
  type MetroConfigLike,
  type MetroResolutionContext,
  type MetroResolveRequest,
  withRnDriverHarness,
} from './metro'

const PROJECT_ROOT = '/ws/apps/app'
const SERVER_ROOT = '/ws'
const HARNESS = '/ws/node_modules/@unrulysystems/rn-playwright-driver/harness/index.ts'
const ENTRY_FILE = `${PROJECT_ROOT}/${E2E_ENTRY_RELATIVE}`
const VIRTUAL = '/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true'

const paths: ExpoPaths = {
  getMetroServerRoot: () => SERVER_ROOT,
  resolveEntryPoint: (_root, options) =>
    options?.platform === 'android'
      ? `${PROJECT_ROOT}/index.android.ts`
      : `${PROJECT_ROOT}/index.ts`,
}

/** Expo's own rewrite: virtual entry → project entry, plus inferred transform params. */
const expoRewrite = (url: string): string =>
  url.includes('/.expo/.virtual-metro-entry.bundle?')
    ? url.replace('/.expo/.virtual-metro-entry.bundle?', '/apps/app/index.bundle?') +
      '&transform.engine=hermes'
    : url

function memoryFs(): EntryFileIo & { files: Map<string, string>; writes: number } {
  const files = new Map<string, string>()
  const io = {
    files,
    writes: 0,
    existsSync: (file: string) => files.has(file),
    readFileSync: (file: string) => files.get(file) ?? '',
    writeFileSync(file: string, contents: string) {
      io.writes += 1
      files.set(file, contents)
    },
    mkdirSync: () => {},
  }
  return io
}

function baseConfig(): MetroConfigLike {
  return {
    projectRoot: PROJECT_ROOT,
    cacheVersion: '1.0',
    server: { rewriteRequestUrl: expoRewrite },
    resolver: { resolveRequest: null },
  }
}

function contextFrom(originModulePath: string): MetroResolutionContext {
  const resolveRequest = vi.fn<MetroResolveRequest>(() => ({
    type: 'sourceFile',
    filePath: '/fallback',
  }))
  return { originModulePath, resolveRequest }
}

describe('withRnDriverHarness without the marker', () => {
  it('leaves the config alone apart from a cache-version component and writes nothing', () => {
    const io = memoryFs()
    const config = baseConfig()

    const result = withRnDriverHarness(config, { env: {}, paths, fs: io, harnessPath: HARNESS })

    expect(result.cacheVersion).toBe('1.0-rn-driver-off')
    expect(result.server?.rewriteRequestUrl).toBe(expoRewrite)
    expect(result.resolver?.resolveRequest).toBeNull()
    expect(io.files.size).toBe(0)
  })
})

describe('withRnDriverHarness under RN_E2E=1', () => {
  const env = { RN_E2E: '1' }

  it('generates the entry that loads the harness before the app entry', () => {
    const io = memoryFs()

    withRnDriverHarness(baseConfig(), { env, paths, fs: io, harnessPath: HARNESS })

    const source = io.files.get(ENTRY_FILE)
    expect(source).toContain("require('rn-driver:harness')")
    expect(source).toContain("module.exports = require('rn-driver:app-entry')")
    expect(source?.indexOf('rn-driver:harness')).toBeLessThan(
      source?.indexOf('rn-driver:app-entry') ?? -1,
    )
  })

  it('rewrites the entry only when its content changed', () => {
    const io = memoryFs()
    withRnDriverHarness(baseConfig(), { env, paths, fs: io, harnessPath: HARNESS })
    withRnDriverHarness(baseConfig(), { env, paths, fs: io, harnessPath: HARNESS })
    expect(io.writes).toBe(1)
  })

  it('adds a distinct cache-version component so a marker flip invalidates the cache', () => {
    const result = withRnDriverHarness(baseConfig(), {
      env,
      paths,
      fs: memoryFs(),
      harnessPath: HARNESS,
    })
    expect(result.cacheVersion).toBe('1.0-rn-driver-e2e')
  })

  it("serves the generated entry for Expo's virtual entry request, keeping Expo's inferred params", () => {
    const result = withRnDriverHarness(baseConfig(), {
      env,
      paths,
      fs: memoryFs(),
      harnessPath: HARNESS,
    })
    const rewrite = result.server!.rewriteRequestUrl!

    expect(rewrite(VIRTUAL)).toBe(
      '/apps/app/.expo/rn-driver-e2e-entry.bundle?platform=ios&dev=true&transform.engine=hermes',
    )
    expect(rewrite(`http://localhost:8083${VIRTUAL}`)).toBe(
      'http://localhost:8083/apps/app/.expo/rn-driver-e2e-entry.bundle?platform=ios&dev=true&transform.engine=hermes',
    )
  })

  it('serves the generated entry for a direct project-entry request, per platform', () => {
    const result = withRnDriverHarness(baseConfig(), {
      env,
      paths,
      fs: memoryFs(),
      harnessPath: HARNESS,
    })
    const rewrite = result.server!.rewriteRequestUrl!

    expect(rewrite('/apps/app/index.android.bundle?platform=android&dev=true')).toBe(
      '/apps/app/.expo/rn-driver-e2e-entry.bundle?platform=android&dev=true',
    )
    expect(rewrite('/apps/app/index.bundle?platform=ios&dev=true')).toBe(
      '/apps/app/.expo/rn-driver-e2e-entry.bundle?platform=ios&dev=true',
    )
  })

  it('leaves every other request alone', () => {
    const result = withRnDriverHarness(baseConfig(), {
      env,
      paths,
      fs: memoryFs(),
      harnessPath: HARNESS,
    })
    const rewrite = result.server!.rewriteRequestUrl!

    expect(rewrite('/apps/app/other.bundle?platform=ios')).toBe(
      '/apps/app/other.bundle?platform=ios',
    )
    expect(rewrite('/status')).toBe('/status')
    expect(rewrite('/symbolicate')).toBe('/symbolicate')
  })

  it('resolves the two virtual specifiers only from the generated entry', () => {
    const result = withRnDriverHarness(baseConfig(), {
      env,
      paths,
      fs: memoryFs(),
      harnessPath: HARNESS,
    })
    const resolve = result.resolver!.resolveRequest!

    expect(resolve(contextFrom(ENTRY_FILE), 'rn-driver:harness', 'ios')).toEqual({
      type: 'sourceFile',
      filePath: HARNESS,
    })
    expect(resolve(contextFrom(ENTRY_FILE), 'rn-driver:app-entry', 'android')).toEqual({
      type: 'sourceFile',
      filePath: `${PROJECT_ROOT}/index.android.ts`,
    })
    expect(resolve(contextFrom(ENTRY_FILE), 'rn-driver:app-entry', null)).toEqual({
      type: 'sourceFile',
      filePath: `${PROJECT_ROOT}/index.ts`,
    })

    const elsewhere = contextFrom(`${PROJECT_ROOT}/App.tsx`)
    expect(resolve(elsewhere, 'rn-driver:harness', 'ios')).toEqual({
      type: 'sourceFile',
      filePath: '/fallback',
    })
    expect(elsewhere.resolveRequest).toHaveBeenCalledWith(elsewhere, 'rn-driver:harness', 'ios')
  })

  it("chains a consumer's own resolveRequest for every other specifier", () => {
    const previous = vi.fn<MetroResolveRequest>(() => ({
      type: 'sourceFile',
      filePath: '/consumer',
    }))
    const config = { ...baseConfig(), resolver: { resolveRequest: previous } }
    const result = withRnDriverHarness(config, { env, paths, fs: memoryFs(), harnessPath: HARNESS })
    const context = contextFrom(ENTRY_FILE)

    expect(result.resolver!.resolveRequest!(context, 'react-native', 'ios')).toEqual({
      type: 'sourceFile',
      filePath: '/consumer',
    })
    expect(previous).toHaveBeenCalledWith(context, 'react-native', 'ios')
  })

  it('names the missing Expo dependency instead of failing obscurely', () => {
    expect(() =>
      withRnDriverHarness(
        { projectRoot: '/nowhere/app' },
        { env, fs: memoryFs(), harnessPath: HARNESS },
      ),
    ).toThrow(/@expo\/config\/paths/)
  })

  it('requires projectRoot so the entry lands beside the app', () => {
    expect(() =>
      withRnDriverHarness({}, { env, paths, fs: memoryFs(), harnessPath: HARNESS }),
    ).toThrow(/projectRoot/)
  })
})
