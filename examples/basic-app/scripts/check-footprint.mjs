#!/usr/bin/env node
/**
 * Release-artifact footprint check (REQ-SEAM-009): proves the driver reaches this app only
 * under the runner's marker, and never reaches a release artifact.
 *
 * Without `RN_E2E`:
 *   - the app entry and app config contain no driver import and no marker read;
 *   - a release export carries none of the harness strings;
 *   - a Metro-served dev bundle (the request Expo dev clients make) carries none of them;
 *   - a fresh prebuild excludes the four driver native modules on both platforms and scaffolds
 *     no companion.
 * With `RN_E2E=1`:
 *   - a release export still carries no harness string (exports bundle the project entry
 *     directly, REQ-SEAM-002);
 *   - the Metro-served bundle carries the harness;
 *   - a prebuild over the previous native project lifts the exclusion and scaffolds both
 *     companions.
 * Then without the marker again, a prebuild over that project restores the exclusion.
 *
 * Regenerates `ios/` and `android/` (both gitignored) and leaves them in the marker-off state.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const expoBin = path.join(appRoot, 'node_modules/.bin/expo')
const MARKER = 'RN_E2E'
const NATIVE_MODULES = [
  '@unrulysystems/rn-driver-lifecycle',
  '@unrulysystems/rn-driver-screenshot',
  '@unrulysystems/rn-driver-touch',
  '@unrulysystems/rn-driver-view-tree',
]
/** Strings only the harness emits into a bundle. */
const HARNESS_STRINGS = ['__RN_DRIVER__', 'HARNESS_API_VERSION', '[RN_DRIVER] Failed to load']
/** What app source must never contain: a driver harness import or a marker read. */
const SOURCE_FORBIDDEN = /rn-playwright-driver\/harness|RN_E2E|__E2E__|__RN_DRIVER__/
const SOURCE_FILES = ['index.ts', 'App.tsx', 'app.json', 'app.config.ts', 'app.config.js']
const METRO_READY_MS = 120_000
const BUNDLE_FETCH_MS = 480_000

const failures = []
function check(ok, label) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) failures.push(label)
}

function envWithMarker(marked) {
  const env = { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' }
  delete env[MARKER]
  if (marked) env[MARKER] = '1'
  return env
}

function run(command, args, env, label) {
  const result = spawnSync(command, args, {
    cwd: appRoot,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`)
  }
  return result.stdout
}

function countHits(text) {
  return Object.fromEntries(HARNESS_STRINGS.map((s) => [s, text.split(s).length - 1]))
}

function describeHits(hits) {
  return Object.entries(hits)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
}

// --- source footprint (REQ-SEAM-011) --------------------------------------------------------

function sourceFootprint() {
  for (const file of SOURCE_FILES) {
    const full = path.join(appRoot, file)
    if (!existsSync(full)) continue
    const match = SOURCE_FORBIDDEN.exec(readFileSync(full, 'utf8'))
    check(
      match === null,
      `source ${file} has no driver import or marker read${match ? ` (found ${match[0]})` : ''}`,
    )
  }
}

// --- release export ---------------------------------------------------------------------------

function exportBundle(marked) {
  const outDir = mkdtempSync(path.join(tmpdir(), 'rn-driver-footprint-export-'))
  try {
    run(
      expoBin,
      ['export', '--platform', 'ios', '--no-bytecode', '--output-dir', outDir],
      envWithMarker(marked),
      `expo export (${MARKER}${marked ? '=1' : ' unset'})`,
    )
    const jsDir = path.join(outDir, '_expo/static/js/ios')
    const bundles = readdirSync(jsDir).filter((f) => f.endsWith('.js'))
    if (bundles.length === 0) throw new Error(`expo export produced no JS bundle under ${jsDir}`)
    return countHits(bundles.map((f) => readFileSync(path.join(jsDir, f), 'utf8')).join('\n'))
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
}

// --- Metro-served dev bundle ------------------------------------------------------------------

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function waitFor(predicate, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`)
}

async function metroBundle(marked) {
  const port = await freePort()
  const logPath = path.join(
    tmpdir(),
    `rn-driver-footprint-metro-${marked ? 'on' : 'off'}-${port}.log`,
  )
  const log = openSync(logPath, 'w')
  const child = spawn(expoBin, ['start', '--localhost', '--port', String(port)], {
    cwd: appRoot,
    env: envWithMarker(marked),
    stdio: ['ignore', log, log],
    detached: true,
  })
  // `expo start --localhost` binds whichever loopback family `localhost` resolves to on the host
  // (IPv6-only on macOS), so probe both and keep the one that answers.
  const candidates = ['127.0.0.1', '[::1]'].map((host) => `http://${host}:${port}`)
  let base = null
  try {
    await waitFor(
      async () => {
        if (child.exitCode !== null) {
          throw new Error(`expo start exited ${child.exitCode}; see ${logPath}`)
        }
        for (const candidate of candidates) {
          try {
            const res = await fetch(`${candidate}/status`, { signal: AbortSignal.timeout(2000) })
            if (res.ok && (await res.text()).includes('packager-status:running')) {
              base = candidate
              return true
            }
          } catch {
            /* not up on this family yet */
          }
        }
        return false
      },
      METRO_READY_MS,
      `Metro on ${port}`,
    )
    // Two request forms reach Metro for the same entry: Expo Go / `expo start` clients ask for the
    // virtual entry, and a dev client asks for the bundle URL the manifest advertises (the
    // serverRoot-relative entry with its extension kept, e.g. `examples/basic-app/index.ts.bundle`).
    // Both must carry the harness with the marker and neither without it.
    const manifestUrl = await manifestLaunchAssetUrl(base)
    const virtualUrl = `${base}/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true&minify=false&modulesOnly=false&runModule=true`
    const hits = {}
    for (const [label, url] of [
      ['manifest', manifestUrl],
      ['virtual', virtualUrl],
    ]) {
      const res = await fetch(url, { signal: AbortSignal.timeout(BUNDLE_FETCH_MS) })
      const body = await res.text()
      if (!res.ok)
        throw new Error(
          `Metro ${label} bundle request returned ${res.status}:\n${body.slice(0, 2000)}`,
        )
      hits[label] = countHits(body)
    }
    return hits
  } finally {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
  }
}

/** The bundle URL a dev client loads, read from Expo's manifest and re-based onto `base`. */
async function manifestLaunchAssetUrl(base) {
  const res = await fetch(`${base}/`, {
    headers: { 'expo-platform': 'ios', accept: 'application/expo+json,application/json' },
    signal: AbortSignal.timeout(BUNDLE_FETCH_MS),
  })
  const text = await res.text()
  if (!res.ok)
    throw new Error(`Metro manifest request returned ${res.status}:\n${text.slice(0, 2000)}`)
  const manifest = JSON.parse(text)
  const advertised = manifest?.launchAsset?.url
  if (typeof advertised !== 'string') throw new Error('Expo manifest has no launchAsset.url')
  // The manifest names 127.0.0.1; Metro may only answer on the loopback family `base` found.
  const url = new URL(advertised)
  const dev = new URL(`${url.pathname}${url.search}`, base)
  dev.searchParams.set('dev', 'true')
  dev.searchParams.set('minify', 'false')
  dev.searchParams.delete('transform.bytecode')
  return dev.toString()
}

// --- prebuild + autolinking ------------------------------------------------------------------

function parsePodfileExclude(podfile) {
  const line = /^[ \t]*use_expo_modules!(.*)$/m.exec(podfile)
  if (line === null) throw new Error('ios/Podfile has no use_expo_modules! call')
  const list = /exclude[ \t]*(?:=>|:)[ \t]*\[([^\]]*)\]/.exec(line[1])
  return list === null ? [] : parseQuoted(list[1])
}

function parseSettingsExclude(settings) {
  const block =
    /@generated begin rn-driver-native-modules[\s\S]*?@generated end rn-driver-native-modules/.exec(
      settings,
    )
  if (block === null) return []
  // The generated line is `expoAutolinking.exclude = (expoAutolinking.exclude ?: []) + [...]`;
  // the list is the array after the `+`.
  const list = /\+[ \t]*\[([^\]]*)\]/.exec(block[0])
  return list === null ? [] : parseQuoted(list[1])
}

function parseQuoted(body) {
  return body
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
}

function autolinkedPackages(platform, exclude) {
  const args = [
    '--no-warnings',
    '--eval',
    "require('expo/bin/autolinking')",
    'expo-modules-autolinking',
    'resolve',
    '--platform',
    platform,
    '--json',
  ]
  if (exclude.length > 0) args.push('--exclude', ...exclude)
  const out = run(
    'node',
    args,
    envWithMarker(false),
    `expo-modules-autolinking resolve --platform ${platform}`,
  )
  return new Set(JSON.parse(out).modules.map((m) => m.packageName))
}

function prebuild(marked, { clean }) {
  const args = ['prebuild', '--platform', 'all', '--no-install']
  if (clean) args.push('--clean')
  run(
    expoBin,
    args,
    envWithMarker(marked),
    `expo prebuild (${MARKER}${marked ? '=1' : ' unset'}${clean ? ', --clean' : ''})`,
  )
  const iosExclude = parsePodfileExclude(readFileSync(path.join(appRoot, 'ios/Podfile'), 'utf8'))
  const androidExclude = parseSettingsExclude(
    readFileSync(path.join(appRoot, 'android/settings.gradle'), 'utf8'),
  )
  return {
    iosExclude,
    androidExclude,
    apple: autolinkedPackages('apple', iosExclude),
    android: autolinkedPackages('android', androidExclude),
    companions: {
      android: existsSync(path.join(appRoot, 'android/app/src/androidTest/AndroidManifest.xml')),
      ios: readdirSync(path.join(appRoot, 'ios')).some((entry) => entry.endsWith('UITests')),
    },
  }
}

function assertModules(result, label, expectPresent) {
  for (const platform of ['apple', 'android']) {
    const present = NATIVE_MODULES.filter((m) => result[platform].has(m))
    check(
      expectPresent ? present.length === NATIVE_MODULES.length : present.length === 0,
      `${label}: ${platform} autolinking ${expectPresent ? 'includes' : 'excludes'} the driver modules (present: ${present.length}/${NATIVE_MODULES.length}, exclude list: ${result[platform === 'apple' ? 'iosExclude' : 'androidExclude'].length})`,
    )
  }
  check(
    result.companions.android === expectPresent && result.companions.ios === expectPresent,
    `${label}: companion scaffolds ${expectPresent ? 'present' : 'absent'} (android=${result.companions.android}, ios=${result.companions.ios})`,
  )
}

// --- main ------------------------------------------------------------------------------------

const noHits = (hits) => Object.values(hits).every((n) => n === 0)

console.log('== source footprint')
sourceFootprint()

console.log(`== ${MARKER} unset`)
const exportOff = exportBundle(false)
check(noHits(exportOff), `release export has no harness string (${describeHits(exportOff)})`)
const metroOff = await metroBundle(false)
for (const [form, hits] of Object.entries(metroOff)) {
  check(
    noHits(hits),
    `Metro dev bundle (${form} entry) has no harness string (${describeHits(hits)})`,
  )
}
assertModules(prebuild(false, { clean: true }), 'fresh prebuild', false)

console.log(`== ${MARKER}=1`)
const exportOn = exportBundle(true)
check(noHits(exportOn), `release export still has no harness string (${describeHits(exportOn)})`)
const metroOn = await metroBundle(true)
for (const [form, hits] of Object.entries(metroOn)) {
  check(
    hits.HARNESS_API_VERSION > 0 && hits.__RN_DRIVER__ > 0,
    `Metro dev bundle (${form} entry) carries the harness (${describeHits(hits)})`,
  )
}
assertModules(prebuild(true, { clean: false }), 'prebuild over the excluded project', true)

console.log(`== ${MARKER} unset again`)
const back = prebuild(false, { clean: false })
for (const platform of ['apple', 'android']) {
  check(
    NATIVE_MODULES.every((m) => !back[platform].has(m)),
    `prebuild over the marked project restores the ${platform} exclusion`,
  )
}

if (failures.length > 0) {
  console.error(`\ncheck:footprint FAILED (${failures.length}):\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log('\ncheck:footprint ok')
