import { beforeEach, describe, expect, it, vi } from "vitest";
import { TouchBackendCommandError, TouchBackendUnavailableError } from "./backend";
import { NativeModuleTouchBackend } from "./native-module-backend";

type NativeResult =
  | { success: true; data: unknown }
  | { success: false; error: string; code: string };

function createBackend(result: NativeResult = { success: true, data: undefined }) {
  const evaluateMock = vi.fn((expression: string): unknown => {
    if (expression.includes("capabilities?.touchNative")) {
      return true;
    }
    return result;
  });
  const evaluate = async <T>(expression: string): Promise<T> => evaluateMock(expression) as T;

  return {
    backend: new NativeModuleTouchBackend({
      platform: "ios",
      evaluate,
      waitForTimeout: vi.fn(),
    }),
    evaluate: evaluateMock,
  };
}

function commandExpressions(evaluate: ReturnType<typeof vi.fn>): string[] {
  return evaluate.mock.calls
    .map(([expression]) => String(expression))
    .filter((expression) => !expression.includes("capabilities?.touchNative"));
}

describe("NativeModuleTouchBackend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("checks the native touch capability during initialization", async () => {
    const { backend, evaluate } = createBackend();

    await backend.init();

    expect(evaluate).toHaveBeenCalledWith(
      "typeof globalThis.__RN_DRIVER__ !== 'undefined' && globalThis.__RN_DRIVER__?.capabilities?.touchNative === true",
    );
  });

  it("throws an actionable unavailable error when the module is absent", async () => {
    const evaluateMock = vi.fn((_expression: string) => false);
    const evaluate = async <T>(expression: string): Promise<T> => evaluateMock(expression) as T;
    const backend = new NativeModuleTouchBackend({
      platform: "ios",
      evaluate,
      waitForTimeout: vi.fn(),
    });

    await expect(backend.init()).rejects.toThrow(TouchBackendUnavailableError);
    await expect(backend.init()).rejects.toMatchObject({
      backend: "native-module",
      message: expect.stringContaining("@0xbigboss/rn-driver-touch"),
    });
  });

  it("serializes native module commands through the harness bridge", async () => {
    const { backend, evaluate } = createBackend();

    const cases = [
      {
        run: () => backend.tap(1, 2),
        expression: "globalThis.__RN_DRIVER__.touchNative.tap(1, 2)",
      },
      {
        run: () => backend.down(3, 4),
        expression: "globalThis.__RN_DRIVER__.touchNative.down(3, 4)",
      },
      {
        run: () => backend.move(5, 6),
        expression: "globalThis.__RN_DRIVER__.touchNative.move(5, 6)",
      },
      { run: () => backend.up(), expression: "globalThis.__RN_DRIVER__.touchNative.up()" },
      {
        run: () => backend.swipe({ x: 7, y: 8 }, { x: 9, y: 10 }, 123),
        expression: "globalThis.__RN_DRIVER__.touchNative.swipe(7, 8, 9, 10, 123)",
      },
      {
        run: () => backend.longPress(11, 12, {}),
        expression: "globalThis.__RN_DRIVER__.touchNative.longPress(11, 12, 500)",
      },
      {
        run: () => backend.longPress(13, 14, { duration: 750 }),
        expression: "globalThis.__RN_DRIVER__.touchNative.longPress(13, 14, 750)",
      },
      {
        run: () => backend.typeText('hello "RN"\n'),
        expression: `globalThis.__RN_DRIVER__.touchNative.typeText(${JSON.stringify('hello "RN"\n')})`,
      },
    ];

    for (const command of cases) {
      await command.run();
    }

    expect(commandExpressions(evaluate)).toEqual(cases.map((command) => command.expression));
  });

  it("maps native command failures to TouchBackendCommandError", async () => {
    const { backend } = createBackend({
      success: false,
      error: "tap failed",
      code: "E_TAP",
    });

    await expect(backend.tap(1, 2)).rejects.toThrow(TouchBackendCommandError);
    await expect(backend.tap(1, 2)).rejects.toMatchObject({
      backend: "native-module",
      code: "E_TAP",
      message: "tap failed",
    });
  });
});
