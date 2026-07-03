#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const cliArgs = parseArgs(process.argv.slice(2))
const bundleId = requiredArg(cliArgs, '--bundle-id')
const udid = requiredArg(cliArgs, '--udid')
const metroUrl = requiredArg(cliArgs, '--metro-url')
const tmp = await mkdtemp(path.join(tmpdir(), 'rn-driver-ios-dev-client-'))

try {
  const plist = path.join(tmp, `${bundleId}.plist`)
  await writeFile(
    plist,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<dict>',
      '  <key>expo.devlauncher.hasGrantedNetworkPermission</key>',
      '  <true/>',
      '  <key>expo.devlauncher.recentlyopenedapps</key>',
      '  <dict>',
      `    <key>${escapeXml(metroUrl)}</key>`,
      '    <dict>',
      '      <key>isEASUpdate</key>',
      '      <false/>',
      '      <key>timestamp</key>',
      `      <integer>${Date.now()}</integer>`,
      '      <key>url</key>',
      `      <string>${escapeXml(metroUrl)}</string>`,
      '    </dict>',
      '  </dict>',
      '</dict>',
      '</plist>',
      '',
    ].join('\n'),
    { mode: 0o600 },
  )

  run('pymobiledevice3', [
    'apps',
    'push',
    '--udid',
    udid,
    bundleId,
    plist,
    `Library/Preferences/${bundleId}.plist`,
  ])
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

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function run(command, argv) {
  const result = spawnSync(command, argv, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${argv.join(' ')} exited ${result.status}`)
  }
}
