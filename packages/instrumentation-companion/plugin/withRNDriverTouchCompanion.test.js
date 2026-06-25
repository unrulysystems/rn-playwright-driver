const { describe, expect, test } = require('bun:test')
const plugin = require('./withRNDriverTouchCompanion')
const appPlugin = require('../app.plugin')

describe('withRNDriverTouchCompanion plugin helpers', () => {
  test('app plugin exports the companion config plugin', () => {
    expect(appPlugin).toBe(plugin)
  })

  test('generates an androidTest manifest for the companion without taking over the app runner', () => {
    const manifest = plugin.androidTestManifest('com.example.app')

    expect(manifest).toContain('package="com.example.app.test"')
    expect(manifest).toContain('android:name="com.rndriver.touchcompanion.RNDriverTouchCompanion"')
    expect(manifest).toContain('android:targetPackage="com.example.app"')
    expect(manifest).toContain('<uses-permission android:name="android.permission.INTERNET" />')
    expect(manifest).not.toContain('testInstrumentationRunner')
    expect(manifest).not.toContain('androidx.test.runner.AndroidJUnitRunner')
  })

  test('adds androidTest dependencies to an existing dependencies block', () => {
    const gradle = [
      'android {',
      '  namespace "com.example.app"',
      '}',
      '',
      'dependencies {',
      '  implementation "com.facebook.react:react-android"',
      '}',
      '',
    ].join('\n')

    const result = plugin.addAndroidTestGradleConfig(gradle)

    expect(result).toContain('implementation "com.facebook.react:react-android"')
    expect(result).toContain('androidTestImplementation "androidx.test:runner:1.6.2"')
    expect(result).toContain('androidTestImplementation "androidx.test:core:1.6.1"')
    expect(result).not.toContain('testInstrumentationRunner')
  })

  test('creates a dependencies block when the app build file does not have one', () => {
    const result = plugin.addAndroidTestGradleConfig('android { namespace "com.example.app" }\n')

    expect(result).toContain('dependencies {')
    expect(result).toContain('androidTestImplementation "androidx.test:runner:1.6.2"')
    expect(result).toContain('androidTestImplementation "androidx.test:core:1.6.1"')
  })

  test('does not duplicate generated Gradle dependencies', () => {
    const once = plugin.addAndroidTestGradleConfig('dependencies {\n}\n')
    const twice = plugin.addAndroidTestGradleConfig(once)

    expect(twice.match(/androidx\.test:runner/g)).toHaveLength(1)
    expect(twice.match(/androidx\.test:core/g)).toHaveLength(1)
  })
})
