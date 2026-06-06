# AGENTS

Repository overview for automated agents and contributors.

## Summary

`rn-playwright-driver` is a Playwright-compatible E2E test driver for React Native apps. The driver runs in Node.js and connects to the app's Hermes runtime via CDP.

## Key directories

- `packages/driver` - Driver, CDP client, harness, and Playwright fixtures
- `packages/view-tree` - Native view tree module (Expo Modules API)
- `packages/screenshot` - Native screenshot module (Expo Modules API)
- `packages/lifecycle` - Native lifecycle module (Expo Modules API)
- `examples/basic-app` - Expo app and E2E tests
- `docs/NATIVE-MODULES-ARCHITECTURE.md` - Architecture reference

## Package architecture

**Core principle:** Optional integrations are separate packages to avoid polluting the dependency tree.

| Package | Purpose | Dependencies |
|---------|---------|--------------|
| `@0xbigboss/rn-playwright-driver` | Core driver + fixtures | None (R3F-free) |

The driver stays renderer-agnostic: it has no Three.js / R3F code. The former
`@0xbigboss/rn-driver-r3f` (`TestBridge`, hit-testing, `dispatchPointer`, locators)
was absorbed into the Scenic monorepo as `@unrulysystems/scenic-three` (the
`<ScenicBridge>` auto-traversal install) + `@unrulysystems/scenic-native` (the
`device.scenic` assertion layer over this driver's `device.evaluate` transport).
Scenic depends on this driver; this driver does not depend on Scenic.

See `docs/NATIVE-MODULES-ARCHITECTURE.md` for full architecture details.

## Read-first files

- `README.md`
- `docs/NATIVE-MODULES-ARCHITECTURE.md`
- `packages/driver/src/types.ts`
- `packages/driver/harness/index.ts`

## Commands

```bash
bun install
bun run check

# E2E (requires Metro + device/simulator)
cd example
bun run test:e2e
```

## Constraints

- Hermes CDP is required; Metro `/json` must be reachable.
- The harness must be imported in the app: `@0xbigboss/rn-playwright-driver/harness`.
- Native modules live in the app; the driver package contains no native code.
