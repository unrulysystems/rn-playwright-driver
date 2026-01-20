import type { Device, DriverEvent } from "@0xbigboss/rn-playwright-driver";
import { expect } from "@0xbigboss/rn-playwright-driver/test";

export type TraceResult = { events: DriverEvent[] };

export async function withTracing(
  device: Device,
  action: () => Promise<void>,
): Promise<DriverEvent[]> {
  await device.startTracing();
  await action();
  const result = await device.stopTracing();
  return result.events;
}

export async function tracePointerDrag(
  device: Device,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options?: { steps?: number },
): Promise<DriverEvent[]> {
  return withTracing(device, async () => {
    await device.pointer.drag(from, to, options);
  });
}

export function expectTraceEvents(result: TraceResult): void {
  expect(result).toHaveProperty("events");
  expect(Array.isArray(result.events)).toBe(true);
}

export function countEvents(events: DriverEvent[], type: DriverEvent["type"]): number {
  return events.filter((event) => event.type === type).length;
}

export function expectEventsAtLeast(
  events: DriverEvent[],
  type: DriverEvent["type"],
  min: number = 1,
): void {
  expect(countEvents(events, type)).toBeGreaterThanOrEqual(min);
}
