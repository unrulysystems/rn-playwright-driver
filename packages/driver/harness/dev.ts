/**
 * RN Driver Harness - dev-only entry point.
 *
 * Usage:
 *   import '@unrulysystems/rn-playwright-driver/harness/dev';
 *
 * Installs the harness only when `__DEV__` is true. Metro inlines `__DEV__`
 * and constant-folds this branch out of a release graph before it collects
 * dependencies, so a release bundle carries none of the harness. A runtime
 * gate (the former `globalThis.__E2E__`) cannot be folded and kept the whole
 * harness in release bundles; the driver attaches through Metro's CDP
 * endpoint, which only a dev bundle exposes, so nothing reachable is lost.
 *
 * The Metro-level install (`@unrulysystems/rn-playwright-driver/metro`) needs
 * no import in app code at all; this entry remains for apps that import the
 * harness from their entry file.
 */

if (__DEV__) {
  void import('./index')
}
