import type { LongPressOptions, Point, PointerEventOptions, TapOptions } from "../types";
import type { TouchBackend } from "./backend";
import { TouchBackendCommandError, TouchBackendUnavailableError } from "./backend";

export type InstrumentationBackendOptions = {
  host?: string;
  port?: number;
  url?: string;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 9999;
const DEFAULT_CONNECT_TIMEOUT = 2_000;
const DEFAULT_REQUEST_TIMEOUT = 10_000;

export class InstrumentationTouchBackend implements TouchBackend {
  readonly name = "instrumentation" as const;
  private readonly baseUrl: string;
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;

  constructor(options: InstrumentationBackendOptions = {}) {
    const host = options.host ?? DEFAULT_HOST;
    const port = options.port ?? DEFAULT_PORT;
    this.baseUrl = options.url ?? `http://${host}:${port}`;
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT;
  }

  async init(): Promise<void> {
    await this.sendCommand({ type: "hello" }, this.connectTimeoutMs);
  }

  async dispose(): Promise<void> {
    return;
  }

  async tap(x: number, y: number, _options?: TapOptions): Promise<void> {
    await this.sendCommand({ type: "tap", x, y });
  }

  async down(x: number, y: number, _options?: PointerEventOptions): Promise<void> {
    await this.sendCommand({ type: "down", x, y });
  }

  async move(x: number, y: number, _options?: PointerEventOptions): Promise<void> {
    await this.sendCommand({ type: "move", x, y });
  }

  async up(_options?: PointerEventOptions): Promise<void> {
    await this.sendCommand({ type: "up" });
  }

  async swipe(from: Point, to: Point, durationMs: number): Promise<void> {
    await this.sendCommand({ type: "swipe", from, to, durationMs });
  }

  async longPress(x: number, y: number, options: LongPressOptions): Promise<void> {
    const durationMs = options?.duration ?? 500;
    await this.sendCommand({ type: "longPress", x, y, durationMs });
  }

  async typeText(text: string): Promise<void> {
    await this.sendCommand({ type: "typeText", text });
  }

  private async sendCommand(
    payload: Record<string, unknown>,
    timeoutOverride?: number,
  ): Promise<void> {
    const controller = new AbortController();
    const timeoutMs = timeoutOverride ?? this.requestTimeoutMs;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/command`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new TouchBackendUnavailableError(
          this.name,
          `HTTP ${response.status} from instrumentation companion`,
        );
      }

      const data = (await response.json()) as {
        ok?: boolean;
        error?: { message?: string; code?: string };
      };

      if (!data.ok) {
        const message = data.error?.message ?? "Instrumentation command failed";
        const code = data.error?.code;
        throw new TouchBackendCommandError(this.name, message, code);
      }
    } catch (error) {
      if (error instanceof TouchBackendCommandError) {
        throw error;
      }
      if (error instanceof TouchBackendUnavailableError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new TouchBackendUnavailableError(this.name, message);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
