// The driver's whole Metro footprint: under the runner's RN_E2E=1 marker the harness loads
// before the app entry from a generated .expo/ file; without it this is the default config.
const { getDefaultConfig } = require('expo/metro-config')
const { withRnDriverHarness } = require('@unrulysystems/rn-playwright-driver/metro')

module.exports = withRnDriverHarness(getDefaultConfig(__dirname))
