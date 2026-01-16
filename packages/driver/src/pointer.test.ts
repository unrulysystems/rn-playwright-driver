/**
 * Tests for Pointer class path methods (dragPath, movePath).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Pointer } from "./pointer";
import type { TouchBackend } from "./touch";

// TimeoutProvider interface for pointer (avoid importing private type)
interface TimeoutProvider {
  waitForTimeout(ms: number): Promise<void>;
}

const FRAME_DELAY_MS = 16;

describe("Pointer Path Methods", () => {
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

  describe("dragPath", () => {
    it("should do nothing for empty path", async () => {
      await pointer.dragPath([]);

      expect(mockBackend.down).not.toHaveBeenCalled();
      expect(mockBackend.move).not.toHaveBeenCalled();
      expect(mockBackend.up).not.toHaveBeenCalled();
    });

    it("should press at first point and release at last", async () => {
      const points = [
        { x: 100, y: 100 },
        { x: 150, y: 150 },
        { x: 200, y: 200 },
      ];

      await pointer.dragPath(points);

      expect(mockBackend.down).toHaveBeenCalledTimes(1);
      expect(mockBackend.down).toHaveBeenCalledWith(100, 100);

      expect(mockBackend.move).toHaveBeenCalledTimes(2);
      expect(mockBackend.move).toHaveBeenNthCalledWith(1, 150, 150);
      expect(mockBackend.move).toHaveBeenNthCalledWith(2, 200, 200);

      expect(mockBackend.up).toHaveBeenCalledTimes(1);
    });

    it("should handle single point path", async () => {
      const points = [{ x: 50, y: 75 }];

      await pointer.dragPath(points);

      expect(mockBackend.down).toHaveBeenCalledWith(50, 75);
      expect(mockBackend.move).not.toHaveBeenCalled();
      expect(mockBackend.up).toHaveBeenCalledTimes(1);
    });

    it("should apply delay between points when specified", async () => {
      const points = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ];

      await pointer.dragPath(points, { delay: 50 });

      // Delay should be applied after each move, plus frame delays for down/up.
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenCalledTimes(4);
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(1, FRAME_DELAY_MS);
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(2, 50);
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(3, 50);
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(4, FRAME_DELAY_MS);
    });

    it("should not apply delay when delay is 0", async () => {
      const points = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ];

      await pointer.dragPath(points, { delay: 0 });

      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenCalledTimes(2);
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(1, FRAME_DELAY_MS);
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenNthCalledWith(2, FRAME_DELAY_MS);
    });

    it("should execute in correct order: down, moves, up", async () => {
      const callOrder: string[] = [];

      mockBackend.down = vi.fn().mockImplementation(() => {
        callOrder.push("down");
        return Promise.resolve();
      });
      mockBackend.move = vi.fn().mockImplementation(() => {
        callOrder.push("move");
        return Promise.resolve();
      });
      mockBackend.up = vi.fn().mockImplementation(() => {
        callOrder.push("up");
        return Promise.resolve();
      });

      await pointer.dragPath([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ]);

      expect(callOrder).toEqual(["down", "move", "move", "up"]);
    });
  });

  describe("movePath", () => {
    it("should do nothing for empty path", async () => {
      await pointer.movePath([]);

      expect(mockBackend.move).not.toHaveBeenCalled();
    });

    it("should move through all points without down/up", async () => {
      const points = [
        { x: 100, y: 100 },
        { x: 150, y: 150 },
        { x: 200, y: 200 },
      ];

      await pointer.movePath(points);

      expect(mockBackend.down).not.toHaveBeenCalled();
      expect(mockBackend.up).not.toHaveBeenCalled();

      expect(mockBackend.move).toHaveBeenCalledTimes(3);
      expect(mockBackend.move).toHaveBeenNthCalledWith(1, 100, 100);
      expect(mockBackend.move).toHaveBeenNthCalledWith(2, 150, 150);
      expect(mockBackend.move).toHaveBeenNthCalledWith(3, 200, 200);
    });

    it("should handle single point path", async () => {
      const points = [{ x: 50, y: 75 }];

      await pointer.movePath(points);

      expect(mockBackend.move).toHaveBeenCalledTimes(1);
      expect(mockBackend.move).toHaveBeenCalledWith(50, 75);
    });

    it("should apply delay between points but not after last", async () => {
      const points = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ];

      await pointer.movePath(points, { delay: 25 });

      // Delay should be applied between points but not after last
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenCalledTimes(2);
      expect(mockTimeoutProvider.waitForTimeout).toHaveBeenCalledWith(25);
    });

    it("should not apply delay for single point", async () => {
      const points = [{ x: 0, y: 0 }];

      await pointer.movePath(points, { delay: 25 });

      expect(mockTimeoutProvider.waitForTimeout).not.toHaveBeenCalled();
    });

    it("should not apply delay when delay is 0", async () => {
      const points = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ];

      await pointer.movePath(points, { delay: 0 });

      expect(mockTimeoutProvider.waitForTimeout).not.toHaveBeenCalled();
    });
  });
});
