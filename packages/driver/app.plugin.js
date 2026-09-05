// Expo resolves `<package>/app.plugin` for an entry in `expo.plugins`; the implementation is the
// tsup-built `./plugin` module (src/plugin.ts).
module.exports = require('./dist/plugin.js').withRnDriverNativeModules
