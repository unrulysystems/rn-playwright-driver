import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstrumentationTouchBackend } from "./instrumentation-backend";

function okResponse(data: unknown = { ok: true }): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as Response;
}

function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({ ok: false }),
  } as Response;
}

function requestBodies(fetchMock: ReturnType<typeof vi.fn>): unknown[] {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
}

describe("InstrumentationTouchBackend", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("sends hello to the configured companion endpoint on initialization", async () => {
    const backend = new InstrumentationTouchBackend({
      host: "10.0.2.2",
      port: 4545,
      connectTimeoutMs: 123,
    });

    await backend.init();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://10.0.2.2:4545/command",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "hello" }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("serializes command payloads as JSON requests", async () => {
    const backend = new InstrumentationTouchBackend({ url: "http://driver.test" });

    await backend.tap(1, 2);
    await backend.down(3, 4);
    await backend.move(5, 6);
    await backend.up();
    await backend.swipe({ x: 7, y: 8 }, { x: 9, y: 10 }, 123);
    await backend.longPress(11, 12, {});
    await backend.longPress(13, 14, { duration: 750 });
    await backend.typeText("hello");

    expect(requestBodies(fetchMock)).toEqual([
      { type: "tap", x: 1, y: 2 },
      { type: "down", x: 3, y: 4 },
      { type: "move", x: 5, y: 6 },
      { type: "up" },
      { type: "swipe", from: { x: 7, y: 8 }, to: { x: 9, y: 10 }, durationMs: 123 },
      { type: "longPress", x: 11, y: 12, durationMs: 500 },
      { type: "longPress", x: 13, y: 14, durationMs: 750 },
      { type: "typeText", text: "hello" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://driver.test/command",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("maps companion command errors", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ ok: false, error: { message: "tap rejected", code: "E_TAP" } }),
    );
    const backend = new InstrumentationTouchBackend();
    const promise = backend.tap(1, 2);

    await expect(promise).rejects.toMatchObject({
      backend: "instrumentation",
      code: "E_TAP",
      message: "tap rejected",
      name: "TouchBackendCommandError",
    });
  });

  it("uses a default command failure message when the companion omits one", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ ok: false }));
    const backend = new InstrumentationTouchBackend();

    await expect(backend.tap(1, 2)).rejects.toMatchObject({
      backend: "instrumentation",
      message: "Instrumentation command failed",
    });
  });

  it("maps HTTP and transport failures to unavailable errors", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(503));
    const backend = new InstrumentationTouchBackend();

    await expect(backend.init()).rejects.toMatchObject({
      backend: "instrumentation",
      message: "HTTP 503 from instrumentation companion",
    });

    fetchMock.mockRejectedValueOnce(new Error("connection refused"));
    await expect(backend.tap(1, 2)).rejects.toMatchObject({
      backend: "instrumentation",
      message: "connection refused",
      name: "TouchBackendUnavailableError",
    });
  });

  it("aborts requests when the configured timeout elapses", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const backend = new InstrumentationTouchBackend({ requestTimeoutMs: 25 });

    const promise = backend.tap(1, 2);
    const assertion = expect(promise).rejects.toMatchObject({
      backend: "instrumentation",
      message: "aborted",
    });
    await vi.advanceTimersByTimeAsync(25);

    await assertion;
  });
});
