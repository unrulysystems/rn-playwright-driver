---
'@unrulysystems/rn-playwright-driver-runner': patch
---

Fix `rn-driver test --platform ios` failing from-scratch in hoisted monorepos.

The iOS `scaffold` step spawned the XCTest scaffold via a cwd-relative
`node_modules/.bin/rn-driver-xctest-scaffold` literal, which `ENOENT`s in a
Yarn-berry hoisted workspace: the companion's bin is installed to the repo-root
`node_modules` while the app workspace's `.bin` is empty, and the runner's cwd is
the app workspace. The runner now resolves the scaffold to an absolute path via
`createRequire(<cwd>/package.json)` (walking `node_modules` up to the repo root,
hoist-safe) and spawns it as `node <abs scaffold.js>`. Reading the installed
companion's own `bin` field keeps resolution deterministic — no `npx` registry or
version drift.
