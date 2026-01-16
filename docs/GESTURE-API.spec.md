# Unified Gesture API Specification

## Status: Draft

## Stability Policy

**This package is in alpha (pre-1.0).** Breaking changes are expected and acceptable during alpha development. No backward compatibility shims will be maintained.

- **Current version:** 0.1.x (alpha)
- **Breaking changes:** Expected in any 0.x release
- **Semver stability:** Begins at 1.0.0 release
- **Migration support:** Breaking changes are documented but not shimmed

Consumers should pin to exact versions during alpha and review changelogs before upgrading.

---

## Summary

A unified, timing-aware gesture API for `@0xbigboss/rn-playwright-driver` that provides Playwright compatibility while extending support for React Native and Three.js/R3F applications.

## Motivation

### Problem

The current pointer API has several issues:

1. **Hidden timing** — Frame delays (16ms) are hardcoded, not configurable
2. **Inconsistent APIs** — `drag()` uses steps, `swipe()` uses duration, different defaults
3. **No complex gestures** — No way to compose arc, bezier, or multi-segment gestures
4. **No multi-touch** — Pinch/zoom/rotate require manual coordination
5. **React state timing** — Apps using React state for drag tracking need explicit hold times

### Goals

- Single unified pointer abstraction (no separate mouse/touchscreen)
- Timing as first-class citizen (holdStart, holdEnd, duration)
- Builder pattern for complex/custom gestures
- Multi-touch ready from the start
- Playwright API parity with RN/Three.js extensions

### Non-Goals

- Backward compatibility with current API (breaking changes accepted)
- Mouse-specific features (right-click, middle-click) in initial version

---

## API Design

### Types

```typescript
// Coordinate in logical points (matches RN coordinate system)
interface Point {
  x: number;
  y: number;
}

// Timing defaults that work for React state updates
const FRAME_MS = 16; // ~60fps

// Easing functions
type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | ((t: number) => number);

// Pointer event options (for future multi-touch, pressure)
interface PointerEventOptions {
  /** Pointer ID for multi-touch (default: 0) */
  pointerId?: number;
  /** Pressure 0-1 for pressure-sensitive input (default: 1) */
  pressure?: number;
}

// Movement interpolation options
interface MoveOptions extends PointerEventOptions {
  /** Number of intermediate move events (default: 1 = direct) */
  steps?: number;
}

// Timing options for gestures
interface TimingOptions {
  /** Pause after pointer down, before movement (default: 16ms) */
  holdStart?: number;
  /** Pause after movement, before pointer up (default: 16ms) */
  holdEnd?: number;
}

// Interpolation options
// Precedence: if `duration` is set, `steps` is ignored.
// If neither is set, method-specific defaults apply (e.g., drag: 10 steps, swipe: 300ms duration).
interface InterpolationOptions {
  /** Duration-based: total gesture time in ms (takes precedence over steps) */
  duration?: number;
  /** Step-based: number of move events (ignored if duration is set) */
  steps?: number;
  /** Easing function (default: 'linear' for drag, 'ease-out' for swipe) */
  easing?: Easing;
}

// Combined options for drag gestures
interface DragOptions extends TimingOptions, InterpolationOptions {}

// Tap options
// Note: Tap only uses holdStart (delay between down and up). holdEnd is ignored
// since there is no movement phase between down and up.
interface TapOptions {
  /** Pause between down and up (default: 16ms) */
  holdStart?: number;
  /** Number of taps (default: 1) */
  count?: number;
  /** Delay between taps for multi-tap (default: 100ms) */
  tapDelay?: number;
}

// Long press options
interface LongPressOptions extends TimingOptions {
  /** Hold duration in ms (default: 500ms) */
  duration?: number;
}

// Swipe options
// Default interpolation: 300ms duration with ease-out (if neither duration nor steps provided)
interface SwipeOptions extends TimingOptions, InterpolationOptions {
  from: Point;
  to: Point;
}

// Path options for dragPath (includes down/up, so timing options apply)
interface DragPathOptions extends TimingOptions {
  /** Delay between each point in ms (default: 0) */
  delay?: number;
}

// Path options for movePath (no down/up, so no timing options)
interface MovePathOptions {
  /** Delay between each point in ms (default: 0) */
  delay?: number;
}
```

### Level 1: Primitives

Low-level atomic operations with no implicit timing.

```typescript
interface Pointer {
  /**
   * Press down at coordinates.
   * No implicit delays — caller controls timing.
   */
  down(x: number, y: number, options?: PointerEventOptions): Promise<void>;

  /**
   * Move to coordinates.
   * If steps > 1, interpolates linearly between current and target position.
   */
  move(x: number, y: number, options?: MoveOptions): Promise<void>;

  /**
   * Release pointer.
   * No implicit delays — caller controls timing.
   */
  up(options?: PointerEventOptions): Promise<void>;
}
```

### Level 2: Gestures

Common gesture patterns with configurable timing.

```typescript
interface Pointer {
  // ... primitives ...

  /**
   * Tap at coordinates (down → holdStart → up).
   * Note: holdEnd is not used since there is no movement phase.
   * Default holdStart: 16ms
   */
  tap(x: number, y: number, options?: TapOptions): Promise<void>;

  /**
   * Double-tap at coordinates.
   * Equivalent to tap(x, y, { count: 2 })
   * Note: holdEnd is not used since there is no movement phase.
   */
  doubleTap(x: number, y: number, options?: TapOptions): Promise<void>;

  /**
   * Long press at coordinates.
   * down → holdStart → wait(duration) → holdEnd → up
   * Default duration: 500ms
   */
  longPress(x: number, y: number, options?: LongPressOptions): Promise<void>;

  /**
   * Drag from one point to another.
   * down → holdStart → interpolated moves → holdEnd → up
   *
   * Interpolation: duration-based (preferred) or step-based.
   * Default: 10 steps, linear easing, 16ms hold times
   */
  drag(from: Point, to: Point, options?: DragOptions): Promise<void>;

  /**
   * Swipe gesture (alias for drag with different defaults).
   * Default: 300ms duration, ease-out easing
   */
  swipe(options: SwipeOptions): Promise<void>;

  /**
   * Drag along explicit waypoints.
   * down → holdStart → move through points → holdEnd → up
   */
  dragPath(points: Point[], options?: DragPathOptions): Promise<void>;

  /**
   * Move through waypoints without down/up.
   * For hover effects or mid-gesture path changes.
   * Note: No timing options (holdStart/holdEnd) since there is no down/up.
   */
  movePath(points: Point[], options?: MovePathOptions): Promise<void>;

  /**
   * Create a gesture builder for complex sequences.
   */
  gesture(): GestureBuilder;
}
```

### Level 3: Gesture Builder

Declarative builder for complex or custom gestures.

```typescript
interface GestureBuilder {
  // Pointer state
  down(x: number, y: number, options?: PointerEventOptions): this;
  up(options?: PointerEventOptions): this;

  // Movement
  moveTo(x: number, y: number, options?: InterpolationOptions): this;
  moveBy(dx: number, dy: number, options?: InterpolationOptions): this;

  // Timing
  wait(ms: number): this;
  /** Wait for N animation frames (~16ms per frame at 60fps) */
  waitFrames(count: number): this;

  // Path helpers
  arc(
    center: Point,
    radius: number,
    startAngle: number,
    endAngle: number,
    options?: InterpolationOptions
  ): this;

  bezier(
    control1: Point,
    control2: Point,
    end: Point,
    options?: InterpolationOptions
  ): this;

  // Execution
  execute(): Promise<void>;

  // Debug: inspect planned events without executing
  toEvents(): PlannedPointerEvent[];
}

interface PlannedPointerEvent {
  type: 'down' | 'move' | 'up' | 'wait';
  x?: number;
  y?: number;
  ms?: number;
  pointerId?: number;
}
```

**Example usage:**

```typescript
// Orbit camera: arc gesture
await device.pointer.gesture()
  .down(200, 300)
  .wait(16)
  .arc({ x: 200, y: 200 }, 100, 0, Math.PI / 2, { duration: 500 })
  .wait(16)
  .up()
  .execute();

// Bezier curve drag
await device.pointer.gesture()
  .down(100, 100)
  .wait(16)
  .bezier({ x: 150, y: 50 }, { x: 250, y: 150 }, { x: 300, y: 100 }, { duration: 300 })
  .wait(16)
  .up()
  .execute();

// Custom double-tap timing
await device.pointer.gesture()
  .down(100, 100).wait(16).up()
  .wait(50)
  .down(100, 100).wait(16).up()
  .execute();
```

### Level 4: Multi-Touch (Future)

Multi-pointer coordination for pinch, rotate, and complex gestures.

```typescript
interface Pointer {
  // ... single-touch API ...

  /**
   * Pinch gesture with two fingers.
   */
  pinch(options: PinchOptions): Promise<void>;

  /**
   * Two-finger rotation gesture.
   */
  rotate(options: RotateOptions): Promise<void>;

  /**
   * Multi-touch gesture builder.
   */
  multiGesture(): MultiGestureBuilder;
}

interface PinchOptions extends TimingOptions, InterpolationOptions {
  center: Point;
  startDistance: number;
  endDistance: number;
}

interface RotateOptions extends TimingOptions, InterpolationOptions {
  center: Point;
  distance: number;
  startAngle: number;
  endAngle: number;
}

interface MultiGestureBuilder {
  /**
   * Get or create a gesture builder for a specific pointer ID.
   * All events added to the returned builder are automatically tagged with this pointer ID.
   * Each pointer ID gets its own independent event sequence.
   */
  pointer(id: number): GestureBuilder;

  /**
   * Execute all pointer sequences in parallel.
   * Events are dispatched in timestamp order across all pointers.
   * Pointers with the same timing execute their events simultaneously.
   */
  execute(): Promise<void>;
}
```

**Example:**

```typescript
// Two-finger pinch out (zoom in)
// Each .pointer(id) call returns a builder that tags all events with that pointer ID.
// Both pointers execute in parallel during .execute().
const multi = device.pointer.multiGesture();

// Pointer 0: left finger moves left
multi.pointer(0).down(150, 200).moveTo(100, 200, { duration: 300 }).up();

// Pointer 1: right finger moves right (parallel to pointer 0)
multi.pointer(1).down(250, 200).moveTo(300, 200, { duration: 300 }).up();

await multi.execute();
```

---

## Playwright Compatibility

| Playwright | This API | Notes |
|------------|----------|-------|
| `mouse.click(x, y, {delay})` | `pointer.tap(x, y, {holdStart})` | `holdStart` replaces `delay` |
| `mouse.dblclick(x, y)` | `pointer.doubleTap(x, y)` | or `tap(x, y, {count: 2})` |
| `mouse.down()` | `pointer.down(x, y)` | Requires position |
| `mouse.move(x, y, {steps})` | `pointer.move(x, y, {steps})` | Same |
| `mouse.up()` | `pointer.up()` | Same |
| `mouse.wheel(dx, dy)` | `pointer.scroll(dx, dy)` | Future |
| `touchscreen.tap(x, y)` | `pointer.tap(x, y)` | Unified |
| `locator.dragTo(target, {steps})` | `pointer.drag(from, to, {steps})` | Coordinate-based |
| — | `pointer.gesture()` | **New** |
| — | `pointer.pinch()` | **New** |

---

## Three.js / R3F Considerations

For React Three Fiber applications:

1. **Orbit controls** — Use `gesture().arc()` for camera orbiting
2. **Drag controls** — Explicit `holdStart`/`holdEnd` for React state timing
3. **Zoom** — Use `pinch()` or `multiGesture()` for camera zoom
4. **Object rotation** — Smooth interpolation with `duration` + `easing`

The `device.r3f` namespace may add higher-level helpers:

```typescript
interface R3FDeviceNamespace {
  // ... existing locator methods ...

  /** Orbit camera around a point */
  orbit(options: {
    target: { x: number; y: number; z: number };
    deltaAzimuth: number;
    deltaElevation: number;
    duration?: number;
  }): Promise<void>;

  /** Drag a 3D object by screen delta */
  drag3D(
    objectId: string,
    screenDelta: Point,
    options?: DragOptions
  ): Promise<void>;
}
```

---

## Migration from Current API

### Breaking Changes

| Current | New | Change |
|---------|-----|--------|
| `drag(from, to, {steps, delay})` | `drag(from, to, {steps, duration, holdStart, holdEnd})` | `delay` removed, timing options added |
| `swipe({from, to, duration})` | `swipe({from, to, duration, steps, holdStart, holdEnd, easing})` | Timing + easing options added; steps now supported |
| `dragPath(points, {delay})` | `dragPath(points, {delay, holdStart, holdEnd})` | Timing options added (DragPathOptions) |
| `movePath(points, {delay})` | `movePath(points, {delay})` | Unchanged (MovePathOptions, no timing) |
| `longPress(x, y, durationMs)` | `longPress(x, y, {duration, holdStart, holdEnd})` | Options object instead of positional |

### Removed

- `FRAME_DELAY_MS` hardcoded constant — replaced by configurable `holdStart`/`holdEnd`
- Hidden timing behavior — timing is now configurable with sensible defaults

### Per-Method Defaults

Each method has specific defaults tuned for its use case. All timing defaults (16ms) are chosen to allow React state updates to flush between pointer events.

#### Primitives (no defaults)

| Method | Defaults |
|--------|----------|
| `down(x, y)` | No timing (caller controls) |
| `move(x, y)` | `steps: 1` (direct move) |
| `up()` | No timing (caller controls) |

#### Gestures

| Method | Timing Defaults | Interpolation Defaults |
|--------|-----------------|------------------------|
| `tap(x, y)` | `holdStart: 16ms` (holdEnd not used) | — |
| `doubleTap(x, y)` | `holdStart: 16ms`, `tapDelay: 100ms` | — |
| `longPress(x, y)` | `holdStart: 16ms`, `holdEnd: 16ms` | `duration: 500ms` |
| `drag(from, to)` | `holdStart: 16ms`, `holdEnd: 16ms` | `steps: 10`, `easing: 'linear'` |
| `swipe(options)` | `holdStart: 16ms`, `holdEnd: 16ms` | `duration: 300ms`, `easing: 'ease-out'` |
| `dragPath(points)` | `holdStart: 16ms`, `holdEnd: 16ms` | `delay: 0` |
| `movePath(points)` | — (no down/up) | `delay: 0` |

**Interpolation precedence:** If `duration` is provided, `steps` is ignored. If neither is provided, method-specific defaults apply.

---

## Implementation Plan

### Phase 1: Timing Options (Non-Breaking)

Add `holdStart`/`holdEnd` to existing methods without removing current behavior.

**Files:**
- `packages/driver/src/types.ts` — Add new option types
- `packages/driver/src/pointer.ts` — Add options to `drag`, `dragPath`
- `packages/driver/src/touch/harness-backend.ts` — Add options to `tap`, `longPress`

**Acceptance:**
- [ ] `tap(x, y, { holdStart: 0 })` disables frame delay
- [ ] `drag(from, to, { holdStart: 50, holdEnd: 50 })` uses custom timing
- [ ] Defaults match current 16ms behavior

### Phase 2: Duration-Based Interpolation

Add `duration` as alternative to `steps` for time-based gestures.

**Files:**
- `packages/driver/src/pointer.ts` — Add duration logic to `drag`
- `packages/driver/src/easing.ts` — New file with easing functions

**Acceptance:**
- [ ] `drag(from, to, { duration: 300 })` completes in ~300ms
- [ ] `drag(from, to, { duration: 300, easing: 'ease-out' })` applies easing
- [ ] `steps` still works when `duration` not specified

### Phase 3: Gesture Builder

Add `pointer.gesture()` builder for complex sequences.

**Files:**
- `packages/driver/src/gesture-builder.ts` — New file
- `packages/driver/src/pointer.ts` — Add `gesture()` method

**Acceptance:**
- [ ] Builder chains correctly
- [ ] `execute()` runs all planned events
- [ ] `toEvents()` returns planned events for debugging
- [ ] `arc()` and `bezier()` generate correct paths

### Phase 4: API Cleanup (Breaking)

Remove deprecated patterns and finalize the unified API.

**Changes:**
- [ ] `longPress(x, y, durationMs)` → `longPress(x, y, { duration })`
- [ ] Remove internal `FRAME_DELAY_MS` constant
- [ ] Update all documentation

### Phase 5: Multi-Touch (Future)

Add multi-pointer support for pinch/rotate gestures.

**Files:**
- `packages/driver/src/multi-gesture-builder.ts` — New file
- `packages/driver/src/pointer.ts` — Add `pinch`, `rotate`, `multiGesture`
- `packages/driver/harness/index.ts` — Multi-pointer event dispatch

**Acceptance:**
- [ ] `pinch()` works for zoom gestures
- [ ] `multiGesture()` coordinates multiple pointers
- [ ] Harness supports multiple simultaneous touch points

---

## Test Plan

### Unit Tests

- [ ] All timing options work correctly
- [ ] Duration-based interpolation generates correct number of events
- [ ] Easing functions produce expected curves
- [ ] Gesture builder produces correct event sequences
- [ ] `toEvents()` matches what `execute()` dispatches

### Integration Tests

- [ ] Tap with custom holdStart works with React state
- [ ] Drag with duration feels natural on device
- [ ] Arc gesture works for orbit controls
- [ ] Multi-touch pinch works (Phase 5)

### E2E Tests (Example App)

- [ ] R3F drag test passes with new timing options
- [ ] Orbit camera test with arc gesture
- [ ] Complex gesture sequence test

---

## Open Questions

1. **Scroll gesture** — Should `pointer.scroll(dx, dy)` be included for ScrollView testing?
2. **Velocity** — Should swipe support velocity-based completion (fling)?
3. **Pressure** — Is pressure sensitivity needed for any RN use cases?
4. **Cancellation** — Should gestures be cancellable mid-execution?

---

## References

- [Playwright Mouse API](https://playwright.dev/docs/api/class-mouse)
- [Playwright Touchscreen API](https://playwright.dev/docs/api/class-touchscreen)
- [React Native PanResponder](https://reactnative.dev/docs/panresponder)
- [React Three Fiber Events](https://docs.pmnd.rs/react-three-fiber/api/events)
