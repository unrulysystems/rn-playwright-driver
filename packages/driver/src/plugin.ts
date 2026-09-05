/**
 * Expo config plugin (REQ-SEAM-003, REQ-SEAM-004): keeps the driver's native modules out of a
 * production native project.
 *
 * Expo autolinking links every installed Expo module, so a consumer that installs the driver's
 * view-tree, screenshot, lifecycle and touch packages would ship them in release builds. Both
 * platforms accept an exclude list keyed by npm package name (`expo-modules-autolinking`
 * `findModules.js`, `resolveExpoModule`): iOS through `use_expo_modules!(exclude: [...])` in the
 * Podfile, Android through `expoAutolinking.exclude` in `settings.gradle`. The plugin writes that
 * list when the runner's marker (`RN_E2E=1`) is unset and removes its own list when the marker is
 * set. `expo prebuild` without `--clean` reuses existing native files, so both directions are
 * needed for an app that lists the plugin unconditionally to converge on the right state.
 *
 * The RN-CLI autolinking path (`react-native-config`) never links these packages: an Expo module
 * without `react-native.config.js` whose podspec or gradle file overlaps is skipped there
 * (`reactNativeConfig/iosResolver.js`, `androidResolver.js`), so the Expo exclude list is the
 * whole seam.
 */

import type { ConfigPlugin } from '@expo/config-plugins'
import { withPodfile, withSettingsGradle } from '@expo/config-plugins'
import { mergeContents, removeContents } from '@expo/config-plugins/build/utils/generateCode'

import { isE2EMarked } from './e2e-marker'

/** npm names of the driver's native-module packages, the key Expo autolinking excludes by. */
export const NATIVE_MODULE_PACKAGES: readonly string[] = [
  '@unrulysystems/rn-driver-lifecycle',
  '@unrulysystems/rn-driver-screenshot',
  '@unrulysystems/rn-driver-touch',
  '@unrulysystems/rn-driver-view-tree',
]

const GENERATED_TAG = 'rn-driver-native-modules'
/** `use_expo_modules!`, `use_expo_modules!(args)` or `use_expo_modules! args` on one line. */
const USE_EXPO_MODULES_LINE = /^([ \t]*)use_expo_modules!(?:[ \t]*\((.*)\)|[ \t]+(\S.*?))?[ \t]*$/m
/** The `exclude:` (or `:exclude =>`) array argument of that call. */
const EXCLUDE_ARG = /(:exclude[ \t]*=>|exclude:)[ \t]*\[([^\]]*)\]/
const USE_EXPO_MODULES_ANCHOR = /^[ \t]*expoAutolinking\.useExpoModules\(\)/

function quotedList(names: readonly string[]): string {
  return `[${names.map((name) => `'${name}'`).join(', ')}]`
}

function parseQuotedList(body: string): string[] {
  return body
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter((item) => item.length > 0)
}

function rewriteUseExpoModules(contents: string, rewriteArgs: (args: string) => string): string {
  const match = USE_EXPO_MODULES_LINE.exec(contents)
  if (match === null) {
    throw new Error(
      'withRnDriverNativeModules: the Podfile has no `use_expo_modules!` call, so the driver native modules cannot be excluded. ' +
        `Add \`exclude: ${quotedList(NATIVE_MODULE_PACKAGES)}\` to your Expo autolinking call.`,
    )
  }
  const [line, indent = '', parenArgs, bareArgs] = match
  const args = rewriteArgs((parenArgs ?? bareArgs ?? '').trim())
  const call = args.length === 0 ? 'use_expo_modules!' : `use_expo_modules!(${args})`
  return contents.replace(line, `${indent}${call}`)
}

/** The Podfile with the driver packages in the `use_expo_modules!` exclude list (merged, deduplicated). */
export function addPodfileExclusion(contents: string): string {
  return rewriteUseExpoModules(contents, (args) => {
    const existing = EXCLUDE_ARG.exec(args)
    if (existing === null) {
      const exclude = `exclude: ${quotedList(NATIVE_MODULE_PACKAGES)}`
      return args.length === 0 ? exclude : `${args}, ${exclude}`
    }
    const names = parseQuotedList(existing[2] ?? '')
    const merged = [...names, ...NATIVE_MODULE_PACKAGES.filter((name) => !names.includes(name))]
    return args.replace(EXCLUDE_ARG, `${existing[1]} ${quotedList(merged)}`)
  })
}

/** The Podfile with the driver packages out of the exclude list; the argument goes when it empties. */
export function removePodfileExclusion(contents: string): string {
  if (!USE_EXPO_MODULES_LINE.test(contents)) return contents
  return rewriteUseExpoModules(contents, (args) => {
    const existing = EXCLUDE_ARG.exec(args)
    if (existing === null) return args
    const remaining = parseQuotedList(existing[2] ?? '').filter(
      (name) => !NATIVE_MODULE_PACKAGES.includes(name),
    )
    if (remaining.length > 0) {
      return args.replace(EXCLUDE_ARG, `${existing[1]} ${quotedList(remaining)}`)
    }
    return args
      .replace(EXCLUDE_ARG, '')
      .replace(/,[ \t]*,/g, ',')
      .replace(/^[ \t]*,[ \t]*|[ \t]*,[ \t]*$/g, '')
      .trim()
  })
}

const SETTINGS_EXCLUDE_LINE = `expoAutolinking.exclude = (expoAutolinking.exclude ?: []) + ${quotedList(NATIVE_MODULE_PACKAGES)}`

/** `settings.gradle` with a generated exclude assignment directly before `expoAutolinking.useExpoModules()`. */
export function addSettingsGradleExclusion(contents: string): string {
  if (!contents.split('\n').some((line) => USE_EXPO_MODULES_ANCHOR.test(line))) {
    throw new Error(
      'withRnDriverNativeModules: settings.gradle has no `expoAutolinking.useExpoModules()` call, so the driver native modules cannot be excluded. ' +
        `Set \`expoAutolinking.exclude = ${quotedList(NATIVE_MODULE_PACKAGES)}\` before your Expo autolinking call.`,
    )
  }
  return mergeContents({
    src: contents,
    newSrc: SETTINGS_EXCLUDE_LINE,
    tag: GENERATED_TAG,
    anchor: USE_EXPO_MODULES_ANCHOR,
    offset: 0,
    comment: '//',
  }).contents
}

/** `settings.gradle` without the generated exclude assignment. */
export function removeSettingsGradleExclusion(contents: string): string {
  return removeContents({ src: contents, tag: GENERATED_TAG }).contents
}

/**
 * Without `RN_E2E=1`: exclude the driver's native modules from both platforms' autolinking. With
 * it: remove that exclusion. Reads the marker once, when Expo applies the plugin.
 */
export const withRnDriverNativeModules: ConfigPlugin = (config) => {
  const marked = isE2EMarked(process.env)
  const withIos = withPodfile(config, (podfile) => {
    const { contents } = podfile.modResults
    podfile.modResults.contents = marked
      ? removePodfileExclusion(contents)
      : addPodfileExclusion(contents)
    return podfile
  })
  return withSettingsGradle(withIos, (gradle) => {
    const { contents } = gradle.modResults
    gradle.modResults.contents = marked
      ? removeSettingsGradleExclusion(contents)
      : addSettingsGradleExclusion(contents)
    return gradle
  })
}
