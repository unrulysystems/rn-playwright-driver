import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Loads an ES module by absolute path and returns its namespace. Injected in
 * tests; the default uses native dynamic `import`, which resolves `.js`/`.mjs`
 * everywhere and `.ts` under bun (how the example runs). The dedicated
 * TS-loader dependency for plain Node is deferred (SPEC open item).
 */
export type ConfigImporter = (absolutePath: string) => Promise<unknown>

const DEFAULT_CONFIG_NAMES = [
  'rn-driver.config.ts',
  'rn-driver.config.mts',
  'rn-driver.config.mjs',
  'rn-driver.config.js',
]

export interface LoadedConfig {
  readonly path: string
  readonly config: unknown
}

export class ConfigNotFoundError extends Error {
  constructor(searchedFrom: string, configPath: string | undefined) {
    super(
      configPath
        ? `Config file not found: ${configPath}`
        : `No rn-driver.config.{ts,mts,mjs,js} found searching up from ${searchedFrom}`,
    )
    this.name = 'ConfigNotFoundError'
  }
}

const defaultImporter: ConfigImporter = (absolutePath) => import(pathToFileURL(absolutePath).href)

export async function loadConfig(opts: {
  cwd: string
  configPath?: string
  importer?: ConfigImporter
  fileExists?: (p: string) => boolean
}): Promise<LoadedConfig> {
  const importer = opts.importer ?? defaultImporter
  const fileExists = opts.fileExists ?? existsSync

  const resolvedPath = opts.configPath
    ? path.resolve(opts.cwd, opts.configPath)
    : findConfigUp(opts.cwd, fileExists)

  if (!resolvedPath || !fileExists(resolvedPath)) {
    throw new ConfigNotFoundError(opts.cwd, opts.configPath)
  }

  const namespace = await importer(resolvedPath)
  const config = extractDefault(namespace)
  return { path: resolvedPath, config }
}

function extractDefault(namespace: unknown): unknown {
  if (namespace && typeof namespace === 'object' && 'default' in namespace) {
    return (namespace as { default: unknown }).default
  }
  return namespace
}

function findConfigUp(startDir: string, fileExists: (p: string) => boolean): string | undefined {
  let dir = path.resolve(startDir)
  // Walk to the filesystem root; `path.dirname('/') === '/'` terminates the loop.
  for (;;) {
    for (const name of DEFAULT_CONFIG_NAMES) {
      const candidate = path.join(dir, name)
      if (fileExists(candidate)) return candidate
    }
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}
