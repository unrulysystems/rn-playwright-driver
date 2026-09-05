---
'@unrulysystems/rn-playwright-driver-runner': minor
---

Bind the runner-owned Metro to the IPv4 loopback (REQ-METRO-005). Expo advertises `127.0.0.1` in the bundle URL it hands the app, but `expo start --localhost` binds the `localhost` hostname, which Node resolves to `::1` first on hosts that list the IPv6 loopback first; the app then reported "Could not connect to development server" and the `hermes-target` wait timed out. The runner now appends `--dns-result-order=ipv4first` to the Metro process's `NODE_OPTIONS` through a new append-only `CommandSpec.appendEnv`, keeping a consumer's own `NODE_OPTIONS`; `--dry-run` prints it as `NODE_OPTIONS+=…`.
