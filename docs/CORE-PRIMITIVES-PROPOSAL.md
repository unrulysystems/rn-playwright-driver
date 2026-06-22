# Proposal: Core, Framework-Agnostic Primitives for rn-playwright-driver

## Summary

Add a small set of **framework-agnostic** primitives to `@0xbigboss/rn-playwright-driver` that improve reliability and diagnostics for all React Native E2E testing. These primitives avoid any library-specific logic (no Scenic/R3F in core) and focus on universal building blocks: metrics, deterministic timing, robust pointer paths, standardized locator behavior, backend diagnostics, and action tracing.

## Goals

- Improve E2E stability across all RN apps (not just 3D/Scenic)
- Keep the driver **framework-agnostic**
- Provide deterministic timing and input primitives
- Strengthen diagnostics when tests fail

## Non-Goals

- No framework-specific APIs in the driver
- No 3D/raycast/object queries in core
- No app-state inspection (Redux/Zustand/etc.) in core

## Proposed Primitives (All Priority)

### 1) Window + Layout Metrics API

**Why:** Input and layout assertions need consistent coordinate systems.

**API:**

```ts
type WindowMetrics = {
  width: number;        // logical points
  height: number;       // logical points
  pixelRatio: number;
  scale: number;        // alias of pixelRatio
  fontScale: number;
  orientation: "portrait" | "landscape";
  safeAreaInsets?: { top: number; right: number; bottom: number; left: number };
};

device.getWindowMetrics(): Promise<WindowMetrics>;
```

**Implementation (Harness):**

- Use `Dimensions`, `PixelRatio`, and (if installed) safe-area insets.
- Keep values in **logical points** for consistency with RN layouts.

---

### 2) Deterministic Frame / Timing Utilities

**Why:** Animation-heavy UIs and gesture timing are flake-prone without frame control.

**API:**

```ts
device.getFrameCount(): Promise<number>;
device.waitForRaf(count?: number): Promise<void>;     // waits N frames, default 1
device.waitForFrameCount(target: number): Promise<void>;
```

**Implementation (Harness):**

- Maintain a monotonic frame counter incremented by `requestAnimationFrame`.
- Provide `waitForFrameCount` via polling to a target count.

---

### 3) Pointer Path API

**Why:** Linear interpolation often misses targets and accumulates errors.

**API:**

```ts
device.pointer.dragPath(
  points: { x: number; y: number }[],
  options?: { delay?: number }
): Promise<void>;

device.pointer.movePath(
  points: { x: number; y: number }[],
  options?: { delay?: number }
): Promise<void>;
```

**Implementation (Driver):**

- Issue pointer down at first point, pointer moves for each subsequent point, then pointer up.
- Uses existing touch backend selection; no new backend required.

---

### 4) Locator Bounds + Visibility Consistency

**Why:** Every app needs reliable element bounds and visibility in logical points.

**Improvements:**

- `Locator.bounds()` guarantees logical points.
- `Locator.isVisible()` and `Locator.waitFor()` throw consistent, descriptive errors if view-tree module is missing.
- Error messages should explicitly name the required module(s) and how to enable them.

---

### 5) Backend Diagnostics

**Why:** When a pointer action fails, the current error doesn’t always say _why_.

**API:**

```ts
device.getTouchBackendInfo(): Promise<{
  selected: "xctest" | "instrumentation" | "native-module" | "cli" | "harness";
  available: TouchBackendType[];
  reason?: string;
}>;
```

**Behavior:**

- Include backend selection logic in errors for pointer actions.
- Make it trivial to tell if a test is using the harness vs. OS-level injection.

---

### 6) Action + Console Tracing

**Why:** Deterministic debugging requires device-side trace output.

**API:**

```ts
device.startTracing(options?: { includeConsole?: boolean }): Promise<void>;
device.stopTracing(): Promise<{ events: DriverEvent[] }>;
```

**Implementation:**

- Harness stores a bounded ring buffer of driver events.
- Optional console/error capture via CDP (if available).

---

## Acceptance Criteria

1. `device.getWindowMetrics()` returns logical points, pixel ratio, orientation, and safe-area insets (if available).
2. `device.getFrameCount()` increases on RAF; `waitForRaf()` and `waitForFrameCount()` resolve deterministically.
3. `device.pointer.dragPath()` and `movePath()` accept arbitrary point sequences and execute through existing touch backend selection.
4. `Locator.bounds()` is explicitly documented and verified to return logical points.
5. Missing view-tree capability errors are consistent and clearly instruct how to enable the module.
6. `device.getTouchBackendInfo()` reports selected backend and availability.
7. `device.startTracing()` / `stopTracing()` return a structured event list; optional console capture works when CDP supports it.
8. All new APIs are additive and do not break existing tests.

## Checklist

- [ ] Add harness support for window metrics
- [ ] Add harness support for RAF frame counter
- [ ] Add harness trace buffer + event schema
- [ ] Implement driver APIs: `getWindowMetrics()`, `getFrameCount()`, `waitForRaf()`, `waitForFrameCount()`
- [ ] Implement pointer `dragPath()` and `movePath()`
- [ ] Add `getTouchBackendInfo()` and improve backend error messaging
- [ ] Standardize locator visibility/bounds error messages when view-tree is missing
- [ ] Update README + ADVANCED docs with new APIs and coordinate system details
- [ ] Add unit tests for driver API and harness output
