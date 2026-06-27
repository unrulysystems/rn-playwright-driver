const assert = require('node:assert/strict')
const { describe, test } = require('node:test')
const fs = require('fs')
const os = require('os')
const path = require('path')
const plugin = require('./withRNDriverTouchCompanion')
const appPlugin = require('../app.plugin')

describe('withRNDriverTouchCompanion plugin helpers', () => {
  test('app plugin exports the companion config plugin', () => {
    assert.equal(appPlugin, plugin)
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

      assert.equal(typeof config.mods.android.manifest, 'function')
      assert.equal(typeof config.mods.android.appBuildGradle, 'function')
      assert.equal(typeof config.mods.android.dangerous, 'function')

      await config.mods.android.dangerous({
        ...config,
        modRequest: { platformProjectRoot: projectRoot },
      })

      const copiedCompanion = path.join(
        projectRoot,
        'app/src/androidTest/java/com/rndriver/touchcompanion/RNDriverTouchCompanion.kt',
      )
      const manifest = fs.readFileSync(manifestPath, 'utf8')

      assert.equal(fs.existsSync(copiedCompanion), true)
      assert.equal(manifest.includes('android.permission.ACCESS_NETWORK_STATE'), true)
      assert.equal(manifest.includes('android.permission.INTERNET'), true)
      assert.equal(manifest.includes('com.rndriver.touchcompanion.RNDriverTouchCompanion'), true)
      assert.equal(manifest.includes('android:targetPackage="com.example.app"'), true)
    } finally {
      fs.rmSync(projectRoot, { force: true, recursive: true })
    }
  })

  test('generates an androidTest manifest for the companion without taking over the app runner', () => {
    const manifest = plugin.androidTestManifest('com.example.app')

    assert.equal(manifest.includes('package="com.example.app.test"'), true)
    assert.equal(
      manifest.includes('android:name="com.rndriver.touchcompanion.RNDriverTouchCompanion"'),
      true,
    )
    assert.equal(manifest.includes('android:targetPackage="com.example.app"'), true)
    assert.equal(
      manifest.includes('<uses-permission android:name="android.permission.INTERNET" />'),
      true,
    )
    assert.equal(manifest.includes('testInstrumentationRunner'), false)
    assert.equal(manifest.includes('androidx.test.runner.AndroidJUnitRunner'), false)
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

    assert.equal(result.includes('android.permission.ACCESS_NETWORK_STATE'), true)
    assert.equal(result.includes('android.permission.INTERNET'), true)
    assert.equal(result.includes('android:name="androidx.test.runner.AndroidJUnitRunner"'), true)
    assert.equal(
      result.includes('android:name="com.rndriver.touchcompanion.RNDriverTouchCompanion"'),
      true,
    )
    assert.equal(result.includes('android:targetPackage="com.example.app"'), true)
  })

  test('does not duplicate companion manifest entries', () => {
    const once = plugin.addCompanionToAndroidTestManifest(
      plugin.androidTestManifest('com.example.app'),
      'com.example.app',
    )
    const twice = plugin.addCompanionToAndroidTestManifest(once, 'com.example.app')

    assert.equal(twice.match(/android\.permission\.INTERNET/g)?.length ?? 0, 1)
    assert.equal(twice.match(/RNDriverTouchCompanion/g)?.length ?? 0, 1)
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

    assert.equal(result.includes('implementation "com.facebook.react:react-android"'), true)
    assert.equal(result.includes('androidTestImplementation "androidx.test:runner:1.6.2"'), true)
    assert.equal(result.includes('androidTestImplementation "androidx.test:core:1.6.1"'), true)
    assert.equal(result.includes('testInstrumentationRunner'), false)
  })

  test('creates a dependencies block when the app build file does not have one', () => {
    const result = plugin.addAndroidTestGradleConfig('android { namespace "com.example.app" }\n')

    assert.equal(result.includes('dependencies {'), true)
    assert.equal(result.includes('androidTestImplementation "androidx.test:runner:1.6.2"'), true)
    assert.equal(result.includes('androidTestImplementation "androidx.test:core:1.6.1"'), true)
  })

  test('does not duplicate generated Gradle dependencies', () => {
    const once = plugin.addAndroidTestGradleConfig('dependencies {\n}\n')
    const twice = plugin.addAndroidTestGradleConfig(once)

    assert.equal(twice.match(/androidx\.test:runner/g)?.length ?? 0, 1)
    assert.equal(twice.match(/androidx\.test:core/g)?.length ?? 0, 1)
  })
})
