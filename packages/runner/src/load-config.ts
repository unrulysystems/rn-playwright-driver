import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ProjectContext } from './validate'

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

/**
 * Read the app package next to the config so validation can check the config
 * against what is installed (REQ-CFG-006). `undefined` when there is no
 * package.json; an unreadable one is an error naming the path.
 */
export async function readProjectContext(
  dir: string,
  read: (p: string) => Promise<string> = (p) => readFile(p, 'utf8'),
): Promise<ProjectContext | undefined> {
  const packageJsonPath = path.join(dir, 'package.json')
  let raw: string
  try {
    raw = await read(packageJsonPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`${packageJsonPath}: ${(error as Error).message}`, { cause: error })
  }
  const names = (key: string): string[] => {
    if (typeof parsed !== 'object' || parsed === null) return []
    const section = (parsed as Record<string, unknown>)[key]
    return typeof section === 'object' && section !== null ? Object.keys(section) : []
  }
  return { packageJsonPath, dependencies: [...names('dependencies'), ...names('devDependencies')] }
}
