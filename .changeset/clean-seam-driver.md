---
'@unrulysystems/rn-playwright-driver': minor
---

Install the harness from Metro config instead of app source. `@unrulysystems/rn-playwright-driver/metro` exports `withRnDriverHarness(config)`: under the runner's `RN_E2E=1` marker Metro serves a generated entry that loads the harness before the app entry; without it the config is untouched. The package now ships an Expo config plugin (`app.plugin.js`) that excludes the four `@unrulysystems/rn-driver-*` native modules from autolinking on both platforms unless the marker is set, so a production prebuild links none of the driver's native code. `harness/dev` gates on `__DEV__` alone, and the harness schedules no `requestAnimationFrame` loop until a driver first asks for the frame count.

The seam serves the generated entry for both request forms Metro accepts: the extension-less `index.bundle` and the extension-kept `index.ts.bundle` that Expo's dev-client manifest advertises as `launchAsset.url`.
