const { withDangerousMod } = require('@expo/config-plugins')
const { scaffoldCompanion } = require('./plugin/scaffold')

// The runner-emitted marker (REQ-SEAM-001). A local literal on purpose: the companion carries no
// dependency on the driver or the runner, so the name is duplicated rather than imported.
const E2E_MARKER = 'RN_E2E'

function withRNDriverXCTestCompanion(config) {
  return withDangerousMod(config, [
    'ios',
    async (dangerousConfig) => {
      const projectRoot = dangerousConfig.modRequest.platformProjectRoot
      const projectName =
        dangerousConfig.modRequest.projectName ||
        dangerousConfig.name ||
        dangerousConfig.slug ||
        'RNDriverApp'

      scaffoldCompanion({ iosDir: projectRoot, projectName })
      return dangerousConfig
    },
  ])
}

/**
 * Inert unless the runner's marker is set (REQ-SEAM-003), so an app lists the plugin
 * unconditionally and a production `expo prebuild` scaffolds no UI test target.
 */
function withRNDriverXCTestCompanionUnderMarker(config) {
  return process.env[E2E_MARKER] === '1' ? withRNDriverXCTestCompanion(config) : config
}

module.exports = withRNDriverXCTestCompanionUnderMarker
module.exports.withRNDriverXCTestCompanion = withRNDriverXCTestCompanion
module.exports.scaffoldCompanion = scaffoldCompanion
