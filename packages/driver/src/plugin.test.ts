import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  NATIVE_MODULE_PACKAGES,
  addPodfileExclusion,
  addSettingsGradleExclusion,
  removePodfileExclusion,
  removeSettingsGradleExclusion,
  withRnDriverNativeModules,
} from './plugin'

const EXCLUDE = `exclude: ['@unrulysystems/rn-driver-lifecycle', '@unrulysystems/rn-driver-screenshot', '@unrulysystems/rn-driver-touch', '@unrulysystems/rn-driver-view-tree']`

/** The `use_expo_modules!` region of the Expo SDK 56 template Podfile. */
function podfile(call = 'use_expo_modules!'): string {
  return [
    'require File.join(File.dirname(`node --print "require.resolve(\'expo/package.json\')"`), "scripts/autolinking")',
    '',
    'prepare_react_native_project!',
    '',
    "target 'HelloWorld' do",
    `  ${call}`,
    '',
    '  config = use_native_modules!(config_command)',
    'end',
    '',
  ].join('\n')
}

/** The autolinking region of the Expo SDK 56 template settings.gradle. */
const SETTINGS_GRADLE = [
  'plugins {',
  '  id("com.facebook.react.settings")',
  '  id("expo-autolinking-settings")',
  '}',
  '',
  'expoAutolinking.useExpoModules()',
  '',
  "rootProject.name = 'HelloWorld'",
  '',
  "include ':app'",
  '',
].join('\n')

describe('Podfile exclusion (REQ-SEAM-004)', () => {
  it('adds the four driver packages to a bare use_expo_modules! call', () => {
    expect(addPodfileExclusion(podfile())).toBe(podfile(`use_expo_modules!(${EXCLUDE})`))
  })

  it('is idempotent', () => {
    const once = addPodfileExclusion(podfile())
    expect(addPodfileExclusion(once)).toBe(once)
  })

  it('merges into an existing exclude list without duplicates', () => {
    const consumer = podfile(
      "use_expo_modules!(exclude: ['expo-dev-client', '@unrulysystems/rn-driver-touch'])",
    )
    expect(addPodfileExclusion(consumer)).toBe(
      podfile(
        "use_expo_modules!(exclude: ['expo-dev-client', '@unrulysystems/rn-driver-touch', '@unrulysystems/rn-driver-lifecycle', '@unrulysystems/rn-driver-screenshot', '@unrulysystems/rn-driver-view-tree'])",
      ),
    )
  })

  it('keeps other arguments and the hash-rocket spelling', () => {
    expect(addPodfileExclusion(podfile("use_expo_modules!(searchPaths: ['../modules'])"))).toBe(
      podfile(`use_expo_modules!(searchPaths: ['../modules'], ${EXCLUDE})`),
    )
    expect(addPodfileExclusion(podfile("use_expo_modules!(:exclude => ['foo'])"))).toBe(
      podfile(
        "use_expo_modules!(:exclude => ['foo', '@unrulysystems/rn-driver-lifecycle', '@unrulysystems/rn-driver-screenshot', '@unrulysystems/rn-driver-touch', '@unrulysystems/rn-driver-view-tree'])",
      ),
    )
  })

  it('fails loudly when the Podfile has no use_expo_modules! call', () => {
    expect(() => addPodfileExclusion("target 'App' do\nend\n")).toThrow(/use_expo_modules!/)
  })

  it('removal restores the bare call and leaves a consumer list intact', () => {
    expect(removePodfileExclusion(addPodfileExclusion(podfile()))).toBe(podfile())
    expect(
      removePodfileExclusion(
        addPodfileExclusion(podfile("use_expo_modules!(exclude: ['expo-dev-client'])")),
      ),
    ).toBe(podfile("use_expo_modules!(exclude: ['expo-dev-client'])"))
    expect(
      removePodfileExclusion(
        addPodfileExclusion(podfile("use_expo_modules!(searchPaths: ['../modules'])")),
      ),
    ).toBe(podfile("use_expo_modules!(searchPaths: ['../modules'])"))
  })

  it('removal is a no-op on a Podfile without the exclusion or without the call', () => {
    expect(removePodfileExclusion(podfile())).toBe(podfile())
    expect(removePodfileExclusion("target 'App' do\nend\n")).toBe("target 'App' do\nend\n")
  })
})

describe('settings.gradle exclusion (REQ-SEAM-004)', () => {
  it('assigns the exclude list directly before expoAutolinking.useExpoModules()', () => {
    const result = addSettingsGradleExclusion(SETTINGS_GRADLE)
    const lines = result.split('\n')
    const anchor = lines.indexOf('expoAutolinking.useExpoModules()')
    expect(anchor).toBeGreaterThan(0)
    expect(lines[anchor - 1]).toBe('// @generated end rn-driver-native-modules')
    expect(lines[anchor - 2]).toBe(
      "expoAutolinking.exclude = (expoAutolinking.exclude ?: []) + ['@unrulysystems/rn-driver-lifecycle', '@unrulysystems/rn-driver-screenshot', '@unrulysystems/rn-driver-touch', '@unrulysystems/rn-driver-view-tree']",
    )
    expect(lines[anchor - 3]).toMatch(/^\/\/ @generated begin rn-driver-native-modules - /)
    expect(
      result.replace(/\/\/ @generated begin[^\n]*\n[^\n]*\n\/\/ @generated end[^\n]*\n/, ''),
    ).toBe(SETTINGS_GRADLE)
  })

  it('is idempotent and removal restores the original', () => {
    const once = addSettingsGradleExclusion(SETTINGS_GRADLE)
    expect(addSettingsGradleExclusion(once)).toBe(once)
    expect(removeSettingsGradleExclusion(once)).toBe(SETTINGS_GRADLE)
    expect(removeSettingsGradleExclusion(SETTINGS_GRADLE)).toBe(SETTINGS_GRADLE)
  })

  it('fails loudly when settings.gradle has no expoAutolinking.useExpoModules() call', () => {
    expect(() => addSettingsGradleExclusion("rootProject.name = 'App'\n")).toThrow(
      /expoAutolinking\.useExpoModules\(\)/,
    )
  })
})

type PodfileMod = (config: Record<string, unknown>) => Promise<{ modResults: { contents: string } }>

function applied(env: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
  const config = withRnDriverNativeModules({ name: 'Example', slug: 'example' }) as unknown as {
    mods: { ios: { podfile: PodfileMod }; android: { settingsGradle: PodfileMod } }
  }
  const modRequest = { projectRoot: '/app', platformProjectRoot: '/app/ios', introspect: false }
  return {
    podfile: async (contents: string) =>
      (
        await config.mods.ios.podfile({
          ...config,
          modRequest: { ...modRequest, platform: 'ios', modName: 'podfile' },
          modResults: { path: '/app/ios/Podfile', language: 'rb', contents },
        })
      ).modResults.contents,
    settingsGradle: async (contents: string) =>
      (
        await config.mods.android.settingsGradle({
          ...config,
          modRequest: { ...modRequest, platform: 'android', modName: 'settingsGradle' },
          modResults: { path: '/app/android/settings.gradle', language: 'groovy', contents },
        })
      ).modResults.contents,
  }
}

describe('withRnDriverNativeModules (REQ-SEAM-003, REQ-SEAM-004)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('excludes the driver packages on both platforms without the marker', async () => {
    const mods = applied({ RN_E2E: undefined })
    expect(await mods.podfile(podfile())).toBe(podfile(`use_expo_modules!(${EXCLUDE})`))
    expect(await mods.settingsGradle(SETTINGS_GRADLE)).toContain(
      `expoAutolinking.exclude = (expoAutolinking.exclude ?: []) + ${JSON.stringify(NATIVE_MODULE_PACKAGES).replace(/"/g, "'").replace(/,/g, ', ')}`,
    )
  })

  it('removes its exclusion and adds nothing with the marker', async () => {
    const mods = applied({ RN_E2E: '1' })
    expect(await mods.podfile(addPodfileExclusion(podfile()))).toBe(podfile())
    expect(await mods.podfile(podfile())).toBe(podfile())
    expect(await mods.settingsGradle(addSettingsGradleExclusion(SETTINGS_GRADLE))).toBe(
      SETTINGS_GRADLE,
    )
    expect(await mods.settingsGradle(SETTINGS_GRADLE)).toBe(SETTINGS_GRADLE)
  })

  it('treats any value other than 1 as unset', async () => {
    const mods = applied({ RN_E2E: 'true' })
    expect(await mods.podfile(podfile())).toBe(podfile(`use_expo_modules!(${EXCLUDE})`))
  })
})
