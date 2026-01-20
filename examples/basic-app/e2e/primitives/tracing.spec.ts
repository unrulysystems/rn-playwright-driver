/**
 * E2E tests for tracing APIs.
 *
 * Tests startTracing(), stopTracing(), and trace event collection.
 *
 * NOTE: Pointer tracing requires RNDriverTouchInjector to be installed.
 */

import { expect, test } from "@0xbigboss/rn-playwright-driver/test";
import {
  countEvents,
  expectEventsAtLeast,
  expectTraceEvents,
  tracePointerDrag,
  withTracing,
} from "../utils/tracing";

test.describe("Tracing", () => {
  test("startTracing() and stopTracing() complete without error", async ({ device }) => {
    await device.startTracing();
    const result = await device.stopTracing();

    expectTraceEvents(result);
  });

  test("stopTracing() returns events array", async ({ device }) => {
    await device.startTracing();

    // Perform some traceable operations (evaluate is always traced)
    await device.evaluate<number>("1 + 1");

    const result = await device.stopTracing();

    expectTraceEvents(result);
  });

  test("traced events have required properties", async ({ device }) => {
    await device.startTracing();

    // Perform evaluations to generate events
    await device.evaluate<number>("1 + 1");
    await device.evaluate<string>("'hello'");

    const result = await device.stopTracing();

    // Each event should have type and timestamp
    for (const event of result.events) {
      expect(event).toHaveProperty("type");
      expect(event).toHaveProperty("timestamp");
      expect(typeof event.type).toBe("string");
      expect(typeof event.timestamp).toBe("number");
    }
  });

  test("evaluate events are traced", async ({ device }) => {
    await device.startTracing();

    await device.evaluate<number>("1 + 1");

    const result = await device.stopTracing();

    // Should have evaluate events
    expectEventsAtLeast(result.events, "evaluate");
  });

  test("stopTracing() clears the trace buffer", async ({ device }) => {
    await device.startTracing();
    await device.evaluate<number>("1 + 1");
    const result1 = await device.stopTracing();

    // Start a fresh trace
    await device.startTracing();
    const result2 = await device.stopTracing();

    // Second trace should have fewer/no events (buffer was cleared)
    expect(result2.events.length).toBeLessThanOrEqual(result1.events.length);
  });

  test("startTracing() with includeConsole option", async ({ device }) => {
    await device.startTracing({ includeConsole: true });

    // Log something
    await device.evaluate<void>("console.log('test trace log')");

    const result = await device.stopTracing();

    // Console events should be captured if option is true
    // (depends on harness implementation)
    expect(result).toHaveProperty("events");
  });

  test("startTracing() without options uses defaults", async ({ device }) => {
    await device.startTracing();

    const result = await device.stopTracing();

    expectTraceEvents(result);
  });

  test("timestamps are monotonically increasing", async ({ device }) => {
    await device.startTracing();

    // Generate multiple events via evaluate
    await device.evaluate<number>("1 + 1");
    await device.waitForTimeout(10);
    await device.evaluate<number>("2 + 2");
    await device.waitForTimeout(10);
    await device.evaluate<number>("3 + 3");

    const result = await device.stopTracing();

    // Verify timestamps are in order (if there are multiple events)
    const timestamps = result.events.map((event) => event.timestamp);
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });

  // Pointer-specific tracing tests
  test.describe("Pointer Tracing", () => {
    test("pointer events are traced", async ({ device }) => {
      const events = await withTracing(device, async () => {
        await device.pointer.tap(100, 100);
      });

      // Should have pointer:down and pointer:up events from tap
      const downCount = countEvents(events, "pointer:down");
      const upCount = countEvents(events, "pointer:up");
      expect(downCount + upCount).toBeGreaterThan(0);
    });

    test("pointer:move events are traced during drag", async ({ device }) => {
      const events = await tracePointerDrag(
        device,
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { steps: 5 },
      );

      expectEventsAtLeast(events, "pointer:move");
    });
  });
});
