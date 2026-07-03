#!/usr/bin/env node
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const cliArgs = parseArgs(process.argv.slice(2))
const udid = requiredArg(cliArgs, '--udid')
const executableName = requiredArg(cliArgs, '--executable-name')
const tmp = await mkdtemp(path.join(tmpdir(), 'rn-driver-ios-processes-'))

try {
  const jsonPath = path.join(tmp, 'processes.json')
  run('xcrun', [
    'devicectl',
    'device',
    'info',
    'processes',
    '--device',
    udid,
    '--quiet',
    '--json-output',
    jsonPath,
  ])

  const payload = JSON.parse(await readFile(jsonPath, 'utf8'))
  const processes = payload?.result?.runningProcesses
  if (Array.isArray(processes)) {
    for (const process of processes) {
      const executable = typeof process.executable === 'string' ? process.executable : ''
      const pid = process.processIdentifier
      if (
        !Number.isSafeInteger(pid) ||
        !executable.endsWith(`/${executableName}.app/${executableName}`)
      ) {
        continue
      }
      run('xcrun', [
        'devicectl',
        'device',
        'process',
        'terminate',
        '--device',
        udid,
        '--pid',
        String(pid),
      ])
    }
  }
} finally {
  await rm(tmp, { recursive: true, force: true })
}

function parseArgs(argv) {
  const parsed = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || !value) {
      throw new Error(`invalid arguments: ${argv.join(' ')}`)
    }
    parsed.set(key, value)
  }
  return parsed
}

function requiredArg(args, name) {
  const value = args.get(name)
  if (!value) throw new Error(`${name} is required`)
  return value
}

function run(command, argv) {
  const result = spawnSync(command, argv, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${argv.join(' ')} exited ${result.status}`)
  }
}
