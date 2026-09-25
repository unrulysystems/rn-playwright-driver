---
'@unrulysystems/rn-playwright-driver-runner': patch
---

`resolveProjectRoot` no longer takes an optional third `isDirectory` argument. It was a test seam. The function still checks that a `projectRoot` is a real directory, as before.
