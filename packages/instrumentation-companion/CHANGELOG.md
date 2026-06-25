# @unrulysystems/rn-playwright-driver-instrumentation-companion

## 0.1.2

### Patch Changes

- Republish the Android instrumentation companion after npm accepted `0.1.1`
  but did not expose installable package metadata.

## 0.1.1

### Patch Changes

- Publish the Android instrumentation companion package.
  - Add Expo config plugin packaging that copies the companion runner and writes the androidTest manifest/dependencies.
  - Add auth-token handling for the HTTP companion protocol.
  - Document manual Android instrumentation setup for consumers that cannot use the config plugin.
