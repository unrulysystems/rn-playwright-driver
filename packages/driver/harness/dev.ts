/**
 * RN Driver Harness - Dev/E2E-only Entry Point
 *
 * Usage:
 *   import '@unrulysystems/rn-playwright-driver/harness/dev';
 *
 * This conditionally installs the harness only when:
 * - __DEV__ is true (React Native dev mode), OR
 * - globalThis.__E2E__ is set to true (explicit E2E flag)
 *
 * Use this entry point in production apps to avoid installing
 * the harness in production builds.
 *
 * For always-on harness (e.g., internal testing builds), use:
 *   import '@unrulysystems/rn-playwright-driver/harness';
 */

// Check for dev mode or explicit E2E flag
const isDev = typeof __DEV__ !== 'undefined' && __DEV__
const isE2E =
  typeof globalThis !== 'undefined' &&
  (globalThis as unknown as { __E2E__?: boolean }).__E2E__ === true

if (isDev || isE2E) {
  require('./index')
}
