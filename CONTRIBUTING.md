# Contributing

Thanks for your interest in improving `rn-playwright-driver`. This is a bun
monorepo of small, focused packages; contributions of all sizes are welcome.

## Getting started

```bash
bun install
```

This repo uses [Nix](https://nixos.org/) + [direnv](https://direnv.net/) for a
reproducible toolchain (`flake.nix`, `.envrc`). It is optional — a recent `bun`
and Node `>= 18` are enough — but `direnv allow` will pin the exact versions.

## Quality checks

Run the full gate before opening a pull request:

```bash
bun run check   # typecheck + lint + format:check + test
```

Individual steps:

| Script              | What it does                                |
| ------------------- | ------------------------------------------- |
| `bun run typecheck` | `tsgo --noEmit` across all packages         |
| `bun run lint`      | `oxlint` (autofix with `lint:fix`)          |
| `bun run format`    | `oxfmt --write` (check with `format:check`) |
| `bun run test`      | `vitest` unit suites                        |

Linting and formatting use [oxc](https://oxc.rs/) (`oxlint` / `oxfmt`), not
Biome or Prettier.

## End-to-end tests

E2E tests drive a real React Native app over Hermes CDP, so they need Metro plus
a device or simulator:

```bash
cd examples/basic-app
bun run test:e2e
```

See [`docs/CI.md`](docs/CI.md) for the iOS Simulator / Android Emulator setup.

## Changesets

This repo versions and publishes with [changesets](https://github.com/changesets/changesets).
If your change affects a published package, add a changeset describing it:

```bash
bunx changeset
```

Pick the affected package(s) and a semver bump (`patch` / `minor` / `major`).
Commit the generated file under `.changeset/` with your change. Docs-only or
internal-only changes need no changeset.

## Pull requests

- Keep changes focused and minimal; one concern per PR.
- Match the surrounding code's style and conventions.
- Add or update tests for behavior changes — assertions must verify real
  behavior, never be weakened to pass.
- No new error suppression, fallbacks, or silenced failures to get green.
- Update the relevant docs (`README.md`, `docs/`) when you change the public API.

## Repository layout

| Path                                 | What lives there                                      |
| ------------------------------------ | ----------------------------------------------------- |
| `packages/driver`                    | Driver, CDP client, harness, Playwright fixtures      |
| `packages/shared-types`              | Shared TypeScript types across the packages           |
| `packages/view-tree`                 | Native view-tree module (Expo Modules API)            |
| `packages/screenshot`                | Native screenshot module                              |
| `packages/lifecycle`                 | Native lifecycle module                               |
| `packages/rn-driver-touch`           | App-level native touch injection module               |
| `packages/xctest-companion`          | iOS XCTest touch companion (reference implementation) |
| `packages/instrumentation-companion` | Android Instrumentation touch companion (reference)   |
| `examples/basic-app`                 | Example Expo app + E2E tests                          |
| `docs/`                              | Architecture, API stability, CI, and usage guides     |
