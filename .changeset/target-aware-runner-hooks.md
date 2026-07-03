---
"@unrulysystems/rn-playwright-driver-runner": minor
---

Add target-aware project-owned setup hooks for runner targets.

Projects can now return target-scoped Metro env, Playwright env, command steps,
and cleanup from `hooks.configureTarget`. Hook contributions are rendered in
`--dry-run`, execute through the runner plan, reject secret-looking env keys, and
preserve runner-owned driver env precedence.
