const { describe, expect, test } = require('bun:test')
const fs = require('fs')
const os = require('os')
const path = require('path')
const plugin = require('./withRNDriverTouchCompanion')
const appPlugin = require('../app.plugin')

describe('withRNDriverTouchCompanion plugin helpers', () => {
  test('app plugin exports the companion config plugin', () => {
    expect(appPlugin).toBe(plugin)
  })

  test('exported app plugin registers and runs the Android dangerous mod', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-driver-touch-companion-'))
    try {
      const manifestPath = path.join(projectRoot, 'app/src/androidTest/AndroidManifest.xml')
      fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
      fs.writeFileSync(
        manifestPath,
        `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app.test">
  <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
</manifest>
`,
      )

      const config = appPlugin({
        name: 'Example',
        slug: 'example',
        android: { package: 'com.example.app' },
      })

      expect(config.mods.android.manifest).toBeFunction()
      expect(config.mods.android.appBuildGradle).toBeFunction()
      expect(config.mods.android.dangerous).toBeFunction()

      await config.mods.android.dangerous({
        ...config,
        modRequest: { platformProjectRoot: projectRoot },
      })

      const copiedCompanion = path.join(
        projectRoot,
        'app/src/androidTest/java/com/rndriver/touchcompanion/RNDriverTouchCompanion.kt',
      )
      const manifest = fs.readFileSync(manifestPath, 'utf8')

      expect(fs.existsSync(copiedCompanion)).toBe(true)
      expect(manifest).toContain('android.permission.ACCESS_NETWORK_STATE')
      expect(manifest).toContain('android.permission.INTERNET')
      expect(manifest).toContain('com.rndriver.touchcompanion.RNDriverTouchCompanion')
      expect(manifest).toContain('android:targetPackage="com.example.app"')
    } finally {
      fs.rmSync(projectRoot, { force: true, recursive: true })
    }
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

  test('merges companion entries into an existing androidTest manifest', () => {
    const existing = `<manifest xmlns:android="http://schemas.android.com/apk/res/android"
  package="com.example.app.test">
  <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
  <instrumentation
    android:name="androidx.test.runner.AndroidJUnitRunner"
    android:targetPackage="com.example.app" />
</manifest>
`

    const result = plugin.addCompanionToAndroidTestManifest(existing, 'com.example.app')

    expect(result).toContain('android.permission.ACCESS_NETWORK_STATE')
    expect(result).toContain('android.permission.INTERNET')
    expect(result).toContain('android:name="androidx.test.runner.AndroidJUnitRunner"')
    expect(result).toContain('android:name="com.rndriver.touchcompanion.RNDriverTouchCompanion"')
    expect(result).toContain('android:targetPackage="com.example.app"')
  })

  test('does not duplicate companion manifest entries', () => {
    const once = plugin.addCompanionToAndroidTestManifest(
      plugin.androidTestManifest('com.example.app'),
      'com.example.app',
    )
    const twice = plugin.addCompanionToAndroidTestManifest(once, 'com.example.app')

    expect(twice.match(/android\.permission\.INTERNET/g)).toHaveLength(1)
    expect(twice.match(/RNDriverTouchCompanion/g)).toHaveLength(1)
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
