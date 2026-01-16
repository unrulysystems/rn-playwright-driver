/**
 * Tests for core primitives in the harness.
 * These tests verify the harness functionality in a Node.js environment
 * by mocking the React Native runtime.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock __DEV__ and requestAnimationFrame before importing harness
declare global {
  var __DEV__: boolean | undefined;
  var requestAnimationFrame: (callback: (timestamp: number) => void) => number;
}

// Setup mocks before importing harness
let rafCallbacks: Array<(timestamp: number) => void> = [];
let rafId = 0;

globalThis.__DEV__ = false;
globalThis.requestAnimationFrame = (callback: (timestamp: number) => void): number => {
  rafCallbacks.push(callback);
  return ++rafId;
};

// Mock console to prevent noise during tests
const originalConsole = { ...console };

describe("Harness Core Primitives", () => {
  beforeEach(() => {
    // Reset module cache so harness reinstalls fresh
    vi.resetModules();
    // Reset RAF state
    rafCallbacks = [];
    rafId = 0;
    // Reset __RN_DRIVER__ for fresh install
    globalThis.__RN_DRIVER__ = undefined;
    // Restore console
    Object.assign(console, originalConsole);
  });

  describe("RAF Frame Counter", () => {
    it("should increment frame count on requestAnimationFrame", async () => {
      // Import harness to install
      await import("../harness/index");

      const harness = globalThis.__RN_DRIVER__;
      expect(harness).toBeDefined();

      const initialCount = harness!.getFrameCount();
      expect(typeof initialCount).toBe("number");

      // Simulate RAF ticks
      for (let i = 0; i < 3; i++) {
        const callbacks = [...rafCallbacks];
        rafCallbacks = [];
        for (const cb of callbacks) {
          cb(Date.now());
        }
      }

      const newCount = harness!.getFrameCount();
      expect(newCount).toBeGreaterThanOrEqual(initialCount);
    });
  });

  describe("Tracing", () => {
    it("should not record events when tracing is inactive", async () => {
      await import("../harness/index");
      const harness = globalThis.__RN_DRIVER__;
      expect(harness).toBeDefined();

      // Tracing should be inactive by default
      expect(harness!.isTracing()).toBe(false);

      // Events should not be recorded
      harness!.traceEvent("pointer:tap", { x: 100, y: 200 });

      const result = harness!.stopTracing();
      expect(result.events).toHaveLength(0);
    });

    it("should record events when tracing is active", async () => {
      await import("../harness/index");
      const harness = globalThis.__RN_DRIVER__;
      expect(harness).toBeDefined();

      harness!.startTracing();
      expect(harness!.isTracing()).toBe(true);

      // Record some events
      harness!.traceEvent("pointer:tap", { x: 100, y: 200 });
      harness!.traceEvent("evaluate", { expression: "1+1" });

      const result = harness!.stopTracing();
      expect(result.events.length).toBeGreaterThanOrEqual(2);

      // Verify event structure
      const tapEvent = result.events.find((e) => e.type === "pointer:tap");
      expect(tapEvent).toBeDefined();
      expect(tapEvent!.data).toEqual({ x: 100, y: 200 });
      expect(typeof tapEvent!.timestamp).toBe("number");

      const evalEvent = result.events.find((e) => e.type === "evaluate");
      expect(evalEvent).toBeDefined();
      expect(evalEvent!.data).toEqual({ expression: "1+1" });
    });

    it("should clear events after stopTracing", async () => {
      await import("../harness/index");
      const harness = globalThis.__RN_DRIVER__;
      expect(harness).toBeDefined();

      harness!.startTracing();
      harness!.traceEvent("pointer:tap", { x: 0, y: 0 });
      harness!.stopTracing();

      // Start new tracing session
      harness!.startTracing();
      const result = harness!.stopTracing();
      expect(result.events).toHaveLength(0);
    });

    it("should respect ring buffer limit", async () => {
      await import("../harness/index");
      const harness = globalThis.__RN_DRIVER__;
      expect(harness).toBeDefined();

      harness!.startTracing();

      // Add more events than the buffer limit (1000)
      for (let i = 0; i < 1100; i++) {
        harness!.traceEvent("pointer:move", { x: i, y: i });
      }

      const result = harness!.stopTracing();
      expect(result.events.length).toBeLessThanOrEqual(1000);
    });

    it("should record error events", async () => {
      await import("../harness/index");
      const harness = globalThis.__RN_DRIVER__;
      expect(harness).toBeDefined();

      harness!.startTracing();
      harness!.traceEvent("error", { source: "test", message: "test error" });

      const result = harness!.stopTracing();
      const errorEvent = result.events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.data).toEqual({ source: "test", message: "test error" });
    });
  });

  describe("Window Metrics", () => {
    it("should return fallback metrics in non-RN environment", async () => {
      await import("../harness/index");
      const harness = globalThis.__RN_DRIVER__;
      expect(harness).toBeDefined();

      const metrics = harness!.getWindowMetrics();
      expect(metrics).toEqual({
        width: 0,
        height: 0,
        pixelRatio: 1,
        scale: 1,
        fontScale: 1,
        orientation: "portrait",
      });
    });
  });

  describe("Pointer Events", () => {
    it("should trace pointer tap events", async () => {
      await import("../harness/index");
      const harness = globalThis.__RN_DRIVER__;
      expect(harness).toBeDefined();

      harness!.startTracing();
      harness!.pointer.tap(150, 250);

      const result = harness!.stopTracing();
      const tapEvent = result.events.find((e) => e.type === "pointer:tap");
      expect(tapEvent).toBeDefined();
      expect(tapEvent!.data).toEqual({ x: 150, y: 250 });
    });

    it("should trace pointer down/move/up events", async () => {
      await import("../harness/index");
      const harness = globalThis.__RN_DRIVER__;
      expect(harness).toBeDefined();

      harness!.startTracing();
      harness!.pointer.down(100, 100);
      harness!.pointer.move(150, 150);
      harness!.pointer.up();

      const result = harness!.stopTracing();

      const downEvent = result.events.find((e) => e.type === "pointer:down");
      expect(downEvent).toBeDefined();
      expect(downEvent!.data).toEqual({ x: 100, y: 100 });

      const moveEvent = result.events.find((e) => e.type === "pointer:move");
      expect(moveEvent).toBeDefined();
      expect(moveEvent!.data).toEqual({ x: 150, y: 150 });

      const upEvent = result.events.find((e) => e.type === "pointer:up");
      expect(upEvent).toBeDefined();
      expect(upEvent!.data).toEqual({ x: 150, y: 150 }); // Uses last position
    });

    it("should include pointerId in trace events when provided", async () => {
      await import("../harness/index");
      const harness = globalThis.__RN_DRIVER__;
      expect(harness).toBeDefined();

      harness!.startTracing();
      harness!.pointer.down(5, 6, { pointerId: 2 });

      const result = harness!.stopTracing();
      const downEvent = result.events.find((e) => e.type === "pointer:down");
      expect(downEvent).toBeDefined();
      expect(downEvent!.data).toEqual({ x: 5, y: 6, pointerId: 2 });
    });
  });

  describe("Touch Handler Registration", () => {
    it("should call registered touch handlers on pointer events", async () => {
      await import("../harness/index");
      const harness = globalThis.__RN_DRIVER__;
      expect(harness).toBeDefined();

      const events: Array<{ type: string; x: number; y: number }> = [];
      harness!.registerTouchHandler("test", (event) => {
        events.push({ type: event.type, x: event.x, y: event.y });
      });

      harness!.pointer.down(10, 20);
      harness!.pointer.move(30, 40);
      harness!.pointer.up();

      expect(events).toEqual([
        { type: "down", x: 10, y: 20 },
        { type: "move", x: 30, y: 40 },
        { type: "up", x: 30, y: 40 },
      ]);
    });

    it("should trace error events when touch handler throws", async () => {
      await import("../harness/index");
      const harness = globalThis.__RN_DRIVER__;
      expect(harness).toBeDefined();

      // Suppress console.error for this test
      console.error = vi.fn();

      harness!.registerTouchHandler("failing", () => {
        throw new Error("Handler failed");
      });

      harness!.startTracing();
      harness!.pointer.tap(0, 0);

      const result = harness!.stopTracing();
      const errorEvent = result.events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.data).toMatchObject({
        source: "touchHandler",
        message: "Handler failed",
      });
    });

    it("should unregister touch handlers", async () => {
      await import("../harness/index");
      const harness = globalThis.__RN_DRIVER__;
      expect(harness).toBeDefined();

      let called = false;
      harness!.registerTouchHandler("test", () => {
        called = true;
      });

      harness!.unregisterTouchHandler("test");
      harness!.pointer.tap(0, 0);

      expect(called).toBe(false);
    });
  });
});
