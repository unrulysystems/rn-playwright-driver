---
"@0xbigboss/rn-driver-r3f": minor
---

feat(r3f): add dispatchPointer for native touch injection

Add `dispatchPointer(type, x, y)` method to TestBridge that bypasses React Native's PanResponder and injects pointer events directly into R3F's event system. This fixes native touch injection for E2E tests where UIKit touches don't reach R3F's PanResponder-based event handlers.

Usage from tests:
```typescript
await device.evaluate(`
  globalThis.__RN_DRIVER_R3F__.dispatchPointer('down', ${x}, ${y})
`);
```

New capability flag: `capabilities.pointerDispatch: true`
