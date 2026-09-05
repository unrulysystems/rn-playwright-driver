const withRNDriverTouchCompanion = require('./plugin/withRNDriverTouchCompanion')

// The runner-emitted marker (REQ-SEAM-001). A local literal on purpose: the companion carries no
// dependency on the driver or the runner, so the name is duplicated rather than imported.
const E2E_MARKER = 'RN_E2E'

/**
 * Inert unless the runner's marker is set (REQ-SEAM-003), so an app lists the plugin
 * unconditionally and a production `expo prebuild` scaffolds no instrumentation companion.
 */
function withRNDriverTouchCompanionUnderMarker(config) {
  return process.env[E2E_MARKER] === '1' ? withRNDriverTouchCompanion(config) : config
}

module.exports = withRNDriverTouchCompanionUnderMarker
module.exports.withRNDriverTouchCompanion = withRNDriverTouchCompanion
