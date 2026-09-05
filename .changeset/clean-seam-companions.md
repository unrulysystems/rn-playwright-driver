---
'@unrulysystems/rn-playwright-driver-instrumentation-companion': minor
'@unrulysystems/rn-playwright-driver-xctest-companion': minor
---

The companion config plugins are inert unless `RN_E2E=1` is set for the prebuild (`rn-driver test` sets it), so an app lists them unconditionally and a production prebuild scaffolds nothing. The instrumentation companion README states its native-project requirements: no `MainApplication` change and no app-manifest change.
