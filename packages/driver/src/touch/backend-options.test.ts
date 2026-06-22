import { describe, expect, it, vi } from "vitest";
import { TouchBackendCommandError, TouchBackendNotInitializedError } from "./backend";
import { resolveLongPressDuration, resolveTouchBackendOptions } from "./backend-options";

describe("touch backend options", () => {
  it("builds the default URL and timeout values", () => {
    const buildUrl = vi.fn((host: string, port: number) => `scheme://${host}:${port}`);

    expect(resolveTouchBackendOptions(undefined, buildUrl)).toEqual({
      url: "scheme://127.0.0.1:9999",
      connectTimeoutMs: 2_000,
      requestTimeoutMs: 10_000,
    });
    expect(buildUrl).toHaveBeenCalledWith("127.0.0.1", 9999);
  });

  it("uses host, port, and timeout overrides when no URL is supplied", () => {
    const buildUrl = vi.fn((host: string, port: number) => `scheme://${host}:${port}`);

    expect(
      resolveTouchBackendOptions(
        {
          host: "10.0.2.2",
          port: 4545,
          connectTimeoutMs: 111,
          requestTimeoutMs: 222,
        },
        buildUrl,
      ),
    ).toEqual({
      url: "scheme://10.0.2.2:4545",
      connectTimeoutMs: 111,
      requestTimeoutMs: 222,
    });
  });

  it("uses an explicit URL without rebuilding it from host and port", () => {
    const buildUrl = vi.fn((host: string, port: number) => `scheme://${host}:${port}`);

    expect(
      resolveTouchBackendOptions(
        {
          host: "ignored",
          port: 1,
          url: "scheme://companion.test",
        },
        buildUrl,
      ).url,
    ).toBe("scheme://companion.test");
    expect(buildUrl).not.toHaveBeenCalled();
  });

  it("resolves long-press duration defaults and overrides", () => {
    expect(resolveLongPressDuration(undefined)).toBe(500);
    expect(resolveLongPressDuration({ duration: 750 })).toBe(750);
  });
});

describe("touch backend errors", () => {
  it("preserves command backend and optional code details", () => {
    const error = new TouchBackendCommandError("instrumentation", "tap failed", "E_TAP");

    expect(error.name).toBe("TouchBackendCommandError");
    expect(error.backend).toBe("instrumentation");
    expect(error.message).toBe("tap failed");
    expect(error.code).toBe("E_TAP");
  });

  it("describes the not-initialized state", () => {
    const error = new TouchBackendNotInitializedError("native-module");

    expect(error.name).toBe("TouchBackendNotInitializedError");
    expect(error.backend).toBe("native-module");
    expect(error.message).toContain("Call device.connect() first");
  });
});
