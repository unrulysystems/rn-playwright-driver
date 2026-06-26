const { withDangerousMod } = require('@expo/config-plugins')
const { scaffoldCompanion } = require('./plugin/scaffold')

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

module.exports = withRNDriverXCTestCompanion
module.exports.scaffoldCompanion = scaffoldCompanion
