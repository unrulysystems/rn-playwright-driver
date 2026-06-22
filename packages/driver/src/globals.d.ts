/**
 * Ambient globals injected by the React Native runtime (Metro).
 *
 * Declared once here as a global `var` so module/script files can reference
 * `__DEV__` without a per-file `declare const` — `const` declarations do not
 * merge and, in script-context files, leak to global scope, producing TS2451
 * "Cannot redeclare block-scoped variable" errors across the program.
 */
declare global {
  var __DEV__: boolean | undefined
}

export {}
