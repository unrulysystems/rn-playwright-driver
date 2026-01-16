import type { TouchBackend } from "./touch";
import { TouchBackendNotInitializedError } from "./touch";
import type { PointerOptions, PointerPathOptions, SwipeOptions } from "./types";

const DEFAULT_DRAG_STEPS = 10;
const DEFAULT_DRAG_DELAY = 0;
const DEFAULT_SWIPE_DURATION = 300;
const FRAME_DELAY_MS = 16; // ~60fps

/**
 * Interface for device that supports evaluate().
 * Avoids circular dependency with Device type.
 */
interface TimeoutProvider {
  waitForTimeout(ms: number): Promise<void>;
}

/**
 * Pointer/touch simulation via TouchBackend.
 *
 * Coordinates are in LOGICAL POINTS (same as RN's coordinate system).
 * Origin (0, 0) is top-left of the screen.
 */
export class Pointer {
  private backend: TouchBackend | null;
  private readonly timeoutProvider: TimeoutProvider;

  constructor(backend: TouchBackend | null, timeoutProvider: TimeoutProvider) {
    this.backend = backend;
    this.timeoutProvider = timeoutProvider;
  }

  setBackend(backend: TouchBackend): void {
    this.backend = backend;
  }

  /**
   * Tap at coordinates (down + up).
   */
  async tap(x: number, y: number): Promise<void> {
    await this.getBackend().tap(x, y);
  }

  /**
   * Press down at coordinates.
   */
  async down(x: number, y: number): Promise<void> {
    await this.getBackend().down(x, y);
  }

  /**
   * Move to coordinates (while pressed).
   */
  async move(x: number, y: number): Promise<void> {
    await this.getBackend().move(x, y);
  }

  /**
   * Release press.
   */
  async up(): Promise<void> {
    await this.getBackend().up();
  }

  /**
   * Drag from one point to another with interpolation.
   */
  async drag(
    from: { x: number; y: number },
    to: { x: number; y: number },
    options?: PointerOptions,
  ): Promise<void> {
    const steps = options?.steps ?? DEFAULT_DRAG_STEPS;
    const delay = options?.delay ?? DEFAULT_DRAG_DELAY;

    // Press at start position
    const backend = this.getBackend();
    await backend.down(from.x, from.y);
    await this.timeoutProvider.waitForTimeout(FRAME_DELAY_MS);

    // Interpolate movement
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      await backend.move(x, y);

      if (delay > 0) {
        await this.timeoutProvider.waitForTimeout(delay);
      }
    }

    // Release at end position
    await this.timeoutProvider.waitForTimeout(FRAME_DELAY_MS);
    await backend.up();
  }

  /**
   * Swipe from one point to another with duration-based interpolation.
   * Similar to drag but uses time-based animation for more realistic gesture.
   */
  async swipe(options: SwipeOptions): Promise<void> {
    const duration = options.duration ?? DEFAULT_SWIPE_DURATION;
    await this.getBackend().swipe(options.from, options.to, duration);
  }

  /**
   * Execute a drag gesture along a path of points.
   * Performs down at first point, moves through all points, up at last point.
   *
   * Unlike drag() which interpolates between two points, this follows
   * exact waypoints - useful for complex gestures like bezier curves.
   */
  async dragPath(points: { x: number; y: number }[], options?: PointerPathOptions): Promise<void> {
    if (points.length === 0) {
      return;
    }

    const delay = options?.delay ?? 0;
    const backend = this.getBackend();

    // Press at first point
    await backend.down(points[0].x, points[0].y);
    await this.timeoutProvider.waitForTimeout(FRAME_DELAY_MS);

    // Move through remaining points
    for (let i = 1; i < points.length; i++) {
      await backend.move(points[i].x, points[i].y);
      if (delay > 0) {
        await this.timeoutProvider.waitForTimeout(delay);
      }
    }

    // Release at last point
    await this.timeoutProvider.waitForTimeout(FRAME_DELAY_MS);
    await backend.up();
  }

  /**
   * Move through a path of points without down/up.
   * Useful for hover effects or tracking gestures where the pointer
   * is already down (or doesn't need to be).
   */
  async movePath(points: { x: number; y: number }[], options?: PointerPathOptions): Promise<void> {
    if (points.length === 0) {
      return;
    }

    const delay = options?.delay ?? 0;
    const backend = this.getBackend();

    // Move through all points
    for (let i = 0; i < points.length; i++) {
      await backend.move(points[i].x, points[i].y);
      if (delay > 0 && i < points.length - 1) {
        await this.timeoutProvider.waitForTimeout(delay);
      }
    }
  }

  private getBackend(): TouchBackend {
    if (!this.backend) {
      throw new TouchBackendNotInitializedError("harness");
    }
    return this.backend;
  }
}
