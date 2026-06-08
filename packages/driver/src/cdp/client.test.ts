/**
 * Tests for CDPClient.detectAwaitPromiseSupport — the probe that decides whether evaluate() routes to
 * the native awaitPromise path or the stash fallback. The probe must be SOUND: it may report
 * `awaitPromise` supported only when the runtime genuinely resolves the probe to its sentinel value,
 * not merely when the CDP call returns without an exception (issue #3). The method touches only
 * `this.send` plus two private flags, so stubbing `send` drives all three branches in isolation.
 */
import { describe, expect, it, vi } from "vitest";

import { CDPClient } from "./client";

// The probe and the flag it sets are private; reach them through a narrowly-typed handle rather than a
// bare `any`, so the tests still type-check the exact surface they exercise.
type ClientInternals = {
  send: (method: string, params: object) => Promise<unknown>;
  detectAwaitPromiseSupport: () => Promise<void>;
  supportsAwaitPromise: boolean;
};

const internals = (client: CDPClient): ClientInternals => client as unknown as ClientInternals;

describe("CDPClient.detectAwaitPromiseSupport", () => {
  it("reports supported only when the awaited probe value is genuinely returned (=== 1)", async () => {
    const client = new CDPClient();
    vi.spyOn(internals(client), "send").mockResolvedValue({ result: { value: 1 } });

    await internals(client).detectAwaitPromiseSupport();

    expect(internals(client).supportsAwaitPromise).toBe(true);
  });

  it("reports unsupported when the probe raises a CDP exception", async () => {
    const client = new CDPClient();
    vi.spyOn(internals(client), "send").mockResolvedValue({
      exceptionDetails: { text: "awaitPromise is not supported" },
    });

    await internals(client).detectAwaitPromiseSupport();

    expect(internals(client).supportsAwaitPromise).toBe(false);
  });

  it("reports unsupported for RN's serialized Promise polyfill returned WITHOUT an exception", async () => {
    const client = new CDPClient();
    // React Native's Promise polyfill makes awaitPromise:true resolve to this serialized object instead
    // of the value, with no CDP exception — the exact case the old exception-only probe mis-classified
    // as supported, sending evaluate() down the path that returns garbage on RN.
    vi.spyOn(internals(client), "send").mockResolvedValue({
      result: { value: { _h: 0, _i: 0, _j: null, _k: null } },
    });

    await internals(client).detectAwaitPromiseSupport();

    expect(internals(client).supportsAwaitPromise).toBe(false);
  });
});
