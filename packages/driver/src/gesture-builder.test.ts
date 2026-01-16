import { beforeEach, describe, expect, it, vi } from "vitest";
import { Pointer } from "./pointer";
import type { TouchBackend } from "./touch";

interface TimeoutProvider {
  waitForTimeout(ms: number): Promise<void>;
}

const FRAME_MS = 16;

describe("Gesture Builder", () => {
  let pointer: Pointer;
  let mockBackend: TouchBackend;
  let mockTimeoutProvider: TimeoutProvider;

  beforeEach(() => {
    mockBackend = {
      name: "harness",
      init: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
      tap: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
      move: vi.fn().mockResolvedValue(undefined),
      up: vi.fn().mockResolvedValue(undefined),
      swipe: vi.fn().mockResolvedValue(undefined),
      longPress: vi.fn().mockResolvedValue(undefined),
      typeText: vi.fn().mockResolvedValue(undefined),
    };

    mockTimeoutProvider = {
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };

    pointer = new Pointer(mockBackend, mockTimeoutProvider);
  });

  it("should execute planned events in order", async () => {
    const gesture = pointer
      .gesture()
      .down(0, 0)
      .wait(10)
      .moveTo(10, 0, { steps: 2 })
      .waitFrames(1)
      .up();

    await gesture.execute();

    expect(mockBackend.down).toHaveBeenCalledWith(0, 0);
    expect(mockBackend.move).toHaveBeenCalledTimes(2);
    expect(mockBackend.move).toHaveBeenNthCalledWith(1, 5, 0);
    expect(mockBackend.move).toHaveBeenNthCalledWith(2, 10, 0);
    expect(mockBackend.up).toHaveBeenCalledTimes(1);
    expect(mockTimeoutProvider.waitForTimeout).toHaveBeenCalledTimes(2);
    expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(1, 10);
    expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(2, FRAME_MS);
  });

  it("should expose planned events via toEvents()", () => {
    const events = pointer
      .gesture()
      .down(1, 2)
      .wait(5)
      .moveTo(3, 4)
      .up()
      .toEvents();

    expect(events).toEqual([
      { type: "down", x: 1, y: 2, pointerId: undefined, pressure: undefined },
      { type: "wait", ms: 5 },
      { type: "move", x: 3, y: 4, pointerId: undefined },
      { type: "up", pointerId: undefined, pressure: undefined },
    ]);
  });
});

describe("MultiGesture Builder", () => {
  let pointer: Pointer;
  let mockBackend: TouchBackend;
  let mockTimeoutProvider: TimeoutProvider;

  beforeEach(() => {
    mockBackend = {
      name: "harness",
      init: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
      tap: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
      move: vi.fn().mockResolvedValue(undefined),
      up: vi.fn().mockResolvedValue(undefined),
      swipe: vi.fn().mockResolvedValue(undefined),
      longPress: vi.fn().mockResolvedValue(undefined),
      typeText: vi.fn().mockResolvedValue(undefined),
    };

    mockTimeoutProvider = {
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };

    pointer = new Pointer(mockBackend, mockTimeoutProvider);
  });

  it("should execute pointer sequences in timestamp order", async () => {
    const multi = pointer.multiGesture();
    multi.pointer(0).down(0, 0).wait(20).up();
    multi.pointer(1).down(10, 0).wait(10).up();

    await multi.execute();

    expect(mockBackend.down).toHaveBeenCalledTimes(2);
    expect(mockBackend.down).toHaveBeenNthCalledWith(1, 0, 0, { pointerId: 0 });
    expect(mockBackend.down).toHaveBeenNthCalledWith(2, 10, 0, { pointerId: 1 });

    expect(mockBackend.up).toHaveBeenCalledTimes(2);
    expect(mockBackend.up).toHaveBeenNthCalledWith(1, { pointerId: 1 });
    expect(mockBackend.up).toHaveBeenNthCalledWith(2, { pointerId: 0 });

    expect(mockTimeoutProvider.waitForTimeout).toHaveBeenCalledTimes(2);
    expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(1, 10);
    expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(2, 10);
  });
});
