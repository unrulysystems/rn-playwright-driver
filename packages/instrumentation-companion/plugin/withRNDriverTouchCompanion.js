const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
} = require('@expo/config-plugins')
const fs = require('fs')
const path = require('path')

const COMPANION_CLASS = 'com.rndriver.touchcompanion.RNDriverTouchCompanion'
const GENERATED_TAG = 'rn-driver-touch-companion'
const TEST_RUNNER_DEP = 'androidTestImplementation "androidx.test:runner:1.6.2"'
const TEST_CORE_DEP = 'androidTestImplementation "androidx.test:core:1.6.1"'

function withRNDriverTouchCompanion(config) {
  config = withAndroidManifest(config, (androidConfig) => {
    const manifest = androidConfig.modResults.manifest
    const applicationId = getAndroidPackage(androidConfig, manifest)
    if (!applicationId) {
      throw new Error(
        'RN Driver Touch Companion requires expo.android.package so the androidTest instrumentation can target the app.',
      )
    }
    return androidConfig
  })

  config = withAppBuildGradle(config, (gradleConfig) => {
    gradleConfig.modResults.contents = addAndroidTestGradleConfig(gradleConfig.modResults.contents)
    return gradleConfig
  })

  config = withDangerousMod(config, [
    'android',
    async (dangerousConfig) => {
      const applicationId = getAndroidPackage(dangerousConfig)
      if (!applicationId) {
        throw new Error(
          'RN Driver Touch Companion requires expo.android.package so the androidTest instrumentation can target the app.',
        )
      }

      const projectRoot = dangerousConfig.modRequest.platformProjectRoot
      const javaDest = path.join(
        projectRoot,
        'app/src/androidTest/java/com/rndriver/touchcompanion/RNDriverTouchCompanion.kt',
      )
      const manifestDest = path.join(projectRoot, 'app/src/androidTest/AndroidManifest.xml')
      const source = path.join(
        __dirname,
        '../android/src/main/java/com/rndriver/touchcompanion/RNDriverTouchCompanion.kt',
      )

      await fs.promises.mkdir(path.dirname(javaDest), { recursive: true })
      await fs.promises.mkdir(path.dirname(manifestDest), { recursive: true })
      await fs.promises.copyFile(source, javaDest)
      await fs.promises.writeFile(manifestDest, androidTestManifest(applicationId))

      return dangerousConfig
    },
  ])

  return config
}

function getAndroidPackage(config, manifest) {
  return config.android?.package || manifest?.$?.package || null
}

function addAndroidTestGradleConfig(contents) {
  let next = contents

  if (!next.includes(TEST_RUNNER_DEP)) {
    next = addToDependenciesBlock(next, TEST_RUNNER_DEP)
  }
  if (!next.includes(TEST_CORE_DEP)) {
    next = addToDependenciesBlock(next, TEST_CORE_DEP)
  }
  if (!/testInstrumentationRunner\s+["'][^"']+["']/.test(next)) {
    next = addToDefaultConfigBlock(next, `testInstrumentationRunner "${COMPANION_CLASS}"`)
  }

  return next
}

function addToDependenciesBlock(contents, line) {
  return addToNamedBlock(contents, 'dependencies', generatedBlock(line, '  '))
}

function addToDefaultConfigBlock(contents, line) {
  return addToNamedBlock(contents, 'defaultConfig', generatedBlock(line, '    '))
}

function addToNamedBlock(contents, blockName, block) {
  const blockRegex = new RegExp(`(^|\\n)(\\s*)${blockName}\\s*\\{`)
  const match = blockRegex.exec(contents)

  if (!match) {
    return `${contents.trimEnd()}\n\n${blockName} {\n${block}\n}\n`
  }

  const openBraceIndex = match.index + match[0].lastIndexOf('{')
  const closeBraceIndex = findMatchingBrace(contents, openBraceIndex)
  if (closeBraceIndex < 0) {
    throw new Error(
      `Could not find closing brace for ${blockName} block in android/app/build.gradle`,
    )
  }

  return `${contents.slice(0, closeBraceIndex).trimEnd()}\n${block}\n${contents.slice(closeBraceIndex)}`
}

function generatedBlock(line, indent) {
  return [
    `${indent}// @generated begin ${GENERATED_TAG}`,
    `${indent}${line}`,
    `${indent}// @generated end ${GENERATED_TAG}`,
  ].join('\n')
}

function findMatchingBrace(contents, openBraceIndex) {
  let depth = 0

  for (let index = openBraceIndex; index < contents.length; index += 1) {
    const char = contents[index]
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return index
      }
    }
  }

  return -1
}

function androidTestManifest(applicationId) {
  return `<manifest xmlns:android="http://schemas.android.com/apk/res/android"
  package="${applicationId}.test">
  <instrumentation
    android:name="${COMPANION_CLASS}"
    android:targetPackage="${applicationId}"
    android:functionalTest="false"
    android:handleProfiling="false"
    android:label="RN Driver Touch Companion" />
</manifest>
`
}

module.exports = withRNDriverTouchCompanion
