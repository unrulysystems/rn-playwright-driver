---
'@unrulysystems/rn-playwright-driver-runner': minor
---

Add `projectRoot`: the Expo app directory, relative to the config file. Expo, native builds, Metro and native paths use it, while Playwright and the XCTest companion scaffold resolve from the config file's directory, so a test package separate from the app can own the runner and its dependencies. Unset, it is the config file's directory and nothing changes.
