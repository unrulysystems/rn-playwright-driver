import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IosConfig } from '../config'
import { resolveMetro } from '../plan/resolved'

const execFileMock = vi.hoisted(() => {
  const fn = vi.fn()
  const custom = Symbol.for('nodejs.util.promisify.custom')
  ;(fn as unknown as Record<PropertyKey, unknown>)[custom] = async (
    command: string,
    args: readonly string[],
  ): Promise<{ stdout: string; stderr: string }> => {
    if (command === 'xcrun' && args.join(' ') === 'simctl list devices available --json') {
      return {
        stdout: JSON.stringify({
          devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [
              {
                udid: '0089EDC0-38EB-47D7-8E68-DB4CB80BAD99',
                name: 'iPhone 17',
                state: 'Booted',
                isAvailable: true,
              },
            ],
          },
        }),
        stderr: '',
      }
    }
    if (command === 'xcrun' && args.join(' ') === 'simctl list devices booted') {
      return { stdout: '', stderr: '' }
    }
    throw new Error(`unexpected execFile: ${command} ${args.join(' ')}`)
  }
  return fn
})

vi.mock('node:child_process', () => ({ execFile: execFileMock }))

const { resolveIosTarget } = await import('./resolve')

const COMPANION_PACKAGE = '@unrulysystems/rn-playwright-driver-xctest-companion'
const roots: string[] = []

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('resolveIosTarget', () => {
  it('resolves the scaffold binary from the loaded config project cwd', async () => {
    const projectCwd = await hoistedProjectWithCompanion()
    const ios: IosConfig = {
      bundleId: 'com.example.app',
      workspace: 'ios/App.xcworkspace',
      appScheme: 'App',
      launch: { mode: 'launch', kind: 'plain' },
    }

    const resolved = await resolveIosTarget(ios, resolveMetro({}), { projectCwd })

    const root = await realpath(path.dirname(path.dirname(projectCwd)))
    expect(resolved.scaffoldBin).toBe(
      path.join(root, 'node_modules', COMPANION_PACKAGE, 'bin', 'scaffold.js'),
    )
    await rm(path.dirname(resolved.tokenFile), { recursive: true, force: true })
  })
})

async function hoistedProjectWithCompanion(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'rn-resolve-ios-'))
  roots.push(root)

  const companionDir = path.join(root, 'node_modules', COMPANION_PACKAGE)
  await mkdir(path.join(companionDir, 'bin'), { recursive: true })
  await writeFile(
    path.join(companionDir, 'package.json'),
    JSON.stringify({
      name: COMPANION_PACKAGE,
      version: '0.0.0-test',
      bin: { 'rn-driver-xctest-scaffold': 'bin/scaffold.js' },
    }),
  )
  await writeFile(path.join(companionDir, 'bin', 'scaffold.js'), '#!/usr/bin/env node\n')

  const projectCwd = path.join(root, 'packages', 'app')
  await mkdir(path.join(projectCwd, 'node_modules', '.bin'), { recursive: true })
  await writeFile(path.join(projectCwd, 'package.json'), JSON.stringify({ name: 'app' }))
  return projectCwd
}
