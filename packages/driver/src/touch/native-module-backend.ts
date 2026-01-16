import type { LongPressOptions, Point, PointerEventOptions, TapOptions } from "../types";
import type { TouchBackend, TouchBackendContext } from "./backend";
import { TouchBackendCommandError, TouchBackendUnavailableError } from "./backend";

type NativeResult<T> = { success: true; data: T } | { success: false; error: string; code: string };

export class NativeModuleTouchBackend implements TouchBackend {
  readonly name = "native-module" as const;
  private readonly context: TouchBackendContext;

  constructor(context: TouchBackendContext) {
    this.context = context;
  }

  async init(): Promise<void> {
    await this.ensureModule();
  }

  async dispose(): Promise<void> {
    return;
  }

  async tap(x: number, y: number, _options?: TapOptions): Promise<void> {
    await this.call<void>(`globalThis.__RN_DRIVER__.touchNative.tap(${x}, ${y})`);
  }

  async down(x: number, y: number, _options?: PointerEventOptions): Promise<void> {
    await this.call<void>(`globalThis.__RN_DRIVER__.touchNative.down(${x}, ${y})`);
  }

  async move(x: number, y: number, _options?: PointerEventOptions): Promise<void> {
    await this.call<void>(`globalThis.__RN_DRIVER__.touchNative.move(${x}, ${y})`);
  }

  async up(_options?: PointerEventOptions): Promise<void> {
    await this.call<void>(`globalThis.__RN_DRIVER__.touchNative.up()`);
  }

  async swipe(from: Point, to: Point, durationMs: number): Promise<void> {
    await this.call<void>(
      `globalThis.__RN_DRIVER__.touchNative.swipe(${from.x}, ${from.y}, ${to.x}, ${to.y}, ${durationMs})`,
    );
  }

  async longPress(x: number, y: number, options: LongPressOptions): Promise<void> {
    const durationMs = options?.duration ?? 500;
    await this.call<void>(
      `globalThis.__RN_DRIVER__.touchNative.longPress(${x}, ${y}, ${durationMs})`,
    );
  }

  async typeText(text: string): Promise<void> {
    await this.call<void>(`globalThis.__RN_DRIVER__.touchNative.typeText(${JSON.stringify(text)})`);
  }

  private async call<T>(expression: string): Promise<T> {
    await this.ensureModule();
    const result = await this.context.evaluate<NativeResult<T>>(expression);
    if (!result.success) {
      throw new TouchBackendCommandError(this.name, result.error, result.code);
    }
    return result.data;
  }

  private async ensureModule(): Promise<void> {
    const hasModule = await this.context.evaluate<boolean>(
      "typeof globalThis.__RN_DRIVER__ !== 'undefined' && typeof globalThis.__RN_DRIVER__.touchNative !== 'undefined'",
    );

    if (!hasModule) {
      throw new TouchBackendUnavailableError(
        this.name,
        "RNDriverTouchInjector native module not found in app.",
      );
    }
  }
}
