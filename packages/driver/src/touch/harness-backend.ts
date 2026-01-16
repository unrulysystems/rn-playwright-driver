import type { LongPressOptions, Point, PointerEventOptions, TapOptions } from "../types";
import type { TouchBackend, TouchBackendContext } from "./backend";
import { TouchBackendCommandError, TouchBackendUnavailableError } from "./backend";

const DEFAULT_SWIPE_DURATION = 300;
const DEFAULT_LONG_PRESS_DURATION = 500;
const FRAME_INTERVAL = 16; // ~60fps

/**
 * Error thrown when the harness is not installed in the app.
 */
export class HarnessNotInstalledError extends TouchBackendUnavailableError {
  constructor() {
    super(
      "harness",
      "RN Driver harness not found. Add to your app entry:\n" +
        "  import '@0xbigboss/rn-playwright-driver/harness';",
    );
    this.name = "HarnessNotInstalledError";
  }
}

export class HarnessTouchBackend implements TouchBackend {
  readonly name = "harness" as const;
  private readonly context: TouchBackendContext;

  constructor(context: TouchBackendContext) {
    this.context = context;
  }

  async init(): Promise<void> {
    await this.ensureHarness();
  }

  async dispose(): Promise<void> {
    return;
  }

  async tap(x: number, y: number, options?: TapOptions): Promise<void> {
    await this.ensureHarness();
    await this.down(x, y);
    const holdStart = Math.max(0, options?.holdStart ?? FRAME_INTERVAL);
    if (holdStart > 0) {
      await this.context.waitForTimeout(holdStart);
    }
    await this.up();
  }

  async down(x: number, y: number, options?: PointerEventOptions): Promise<void> {
    await this.ensureHarness();
    const optionsExpression = serializePointerOptions(options);
    await this.context.evaluate<void>(
      `globalThis.__RN_DRIVER__.pointer.down(${x}, ${y}${optionsExpression ? `, ${optionsExpression}` : ""})`,
    );
  }

  async move(x: number, y: number, options?: PointerEventOptions): Promise<void> {
    await this.ensureHarness();
    const optionsExpression = serializePointerOptions(options);
    await this.context.evaluate<void>(
      `globalThis.__RN_DRIVER__.pointer.move(${x}, ${y}${optionsExpression ? `, ${optionsExpression}` : ""})`,
    );
  }

  async up(options?: PointerEventOptions): Promise<void> {
    await this.ensureHarness();
    const optionsExpression = serializePointerOptions(options);
    if (optionsExpression) {
      await this.context.evaluate<void>(`globalThis.__RN_DRIVER__.pointer.up(${optionsExpression})`);
      return;
    }
    await this.context.evaluate<void>(`globalThis.__RN_DRIVER__.pointer.up()`);
  }

  async swipe(from: Point, to: Point, durationMs: number): Promise<void> {
    await this.ensureHarness();

    const duration = durationMs > 0 ? durationMs : DEFAULT_SWIPE_DURATION;
    const steps = Math.max(10, Math.floor(duration / FRAME_INTERVAL));

    await this.down(from.x, from.y);

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const eased = 1 - (1 - t) * (1 - t);
      const x = from.x + (to.x - from.x) * eased;
      const y = from.y + (to.y - from.y) * eased;
      await this.move(x, y);
      await this.context.waitForTimeout(FRAME_INTERVAL);
    }

    await this.up();
  }

  async longPress(x: number, y: number, options: LongPressOptions): Promise<void> {
    await this.ensureHarness();
    const duration = Math.max(0, options?.duration ?? DEFAULT_LONG_PRESS_DURATION);
    await this.down(x, y);
    if (duration > 0) {
      await this.context.waitForTimeout(duration);
    }
    await this.up();
  }

  async typeText(_text: string): Promise<void> {
    throw new TouchBackendCommandError(
      this.name,
      "typeText is not supported by the JS harness backend.",
      "NOT_SUPPORTED",
    );
  }

  private async ensureHarness(): Promise<void> {
    const hasHarness = await this.context.evaluate<boolean>(
      "typeof globalThis.__RN_DRIVER__ !== 'undefined' && typeof globalThis.__RN_DRIVER__.pointer !== 'undefined'",
    );

    if (!hasHarness) {
      throw new HarnessNotInstalledError();
    }
  }
}

function serializePointerOptions(options?: PointerEventOptions): string | null {
  if (!options) {
    return null;
  }
  const payload: PointerEventOptions = {};
  if (options.pointerId !== undefined) {
    payload.pointerId = options.pointerId;
  }
  if (options.pressure !== undefined) {
    payload.pressure = options.pressure;
  }
  return Object.keys(payload).length > 0 ? JSON.stringify(payload) : null;
}
