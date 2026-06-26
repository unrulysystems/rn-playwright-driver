#!/usr/bin/env node

const path = require('path')
const { scaffoldCompanion } = require('../plugin/scaffold')

function usage() {
  console.error(
    'Usage: rn-driver-xctest-scaffold --ios-dir ios [--project-name Example] [--uitest-scheme ExampleUITests]',
  )
}

function readArgs(argv) {
  const args = { iosDir: 'ios', projectName: undefined, uiTestTargetName: undefined }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = argv[i + 1]
    if (arg === '--ios-dir' && value) {
      args.iosDir = value
      i += 1
    } else if (arg === '--project-name' && value) {
      args.projectName = value
      i += 1
    } else if (arg === '--uitest-scheme' && value) {
      args.uiTestTargetName = value
      i += 1
    } else if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    } else {
      usage()
      process.exit(1)
    }
  }
  return args
}

const args = readArgs(process.argv.slice(2))
const result = scaffoldCompanion({
  iosDir: path.resolve(args.iosDir),
  projectName: args.projectName,
  uiTestTargetName: args.uiTestTargetName,
})

console.log(
  `Scaffolded RN Driver XCTest companion target ${result.uiTestTargetName} into ${result.testsDir}`,
)
