# RN / Hermes CDP E2E Playbook

The canonical home for the hard-won constraints of driving a **React Native app over the Chrome
DevTools Protocol (CDP)**. It exists so the gotchas below stop being re-derived independently in the
driver, in Scenic, in Sortessori, and in every future RN E2E effort. When a constraint here conflicts
with a stray comment elsewhere, **this document wins** — fix the other site to point here.

Audience: AI agents and engineers writing or debugging RN E2E over CDP. Voice: third-person, dense,
copy-pasteable. Every claim is grounded in a cited file at a real path.

> All cited files are real and verified. The companion stack docs are linked in [§7 Cross-links](#7-cross-links).

---

## 1. The model: `device` is the RN analog of Playwright's `page`

A test never talks to native UIKit/Android directly. It talks to a **`device`** handle that speaks CDP
to the app's **Hermes VM**, reached through **Metro's inspector proxy**. `device` is to a React Native
app what Playwright's `page` is to a browser tab: the single object you `evaluate` against, locate
elements through, and drive pointer input from.

- Public package: **`@0xbigboss/rn-playwright-driver@0.3.0`**
  (`packages/driver/package.json`).
- The `Device` interface (the stable public surface) is documented in
  `docs/API-STABILITY.md` — `connect`/`disconnect`/`ping`,
  `evaluate`/`waitForFunction`/`waitForTimeout`, `getBy*` locators, `pointer.*`, `screenshot`,
  lifecycle (`openURL`/`reload`/`background`/`foreground`), `capabilities`, and `platform`.
- The concrete implementation is `RNDevice` in
  `packages/driver/src/device.ts`; construct it with
  `createDevice(options)`.

The driver is **renderer-agnostic** — it knows nothing about three.js, WebGPU, or Rapier. It is pure
transport plus generic RN affordances (view-tree locators, native touch, screenshots). Anything 3D is
layered on top (see [§5 The layering](#5-the-layering)).

The connection flow, from `RNDevice.connect()` (`device.ts:64`):

```ts
async connect(): Promise<void> {
  const metroUrl = this.options.metroUrl ?? DEFAULT_METRO_URL; // http://localhost:8081
  const targets = await discoverTargets(metroUrl);
  const target = selectTarget(targets, this.options);
  await this.cdp.connect(target.webSocketDebuggerUrl);
  this._platform = await this.detectPlatform(target);
  // ... touch backend selection ...
}
```

`this.cdp` is a `CDPClient` (`src/cdp/client.ts`) — a thin `ws` WebSocket wrapper that does request/id
correlation, timeouts, and (optionally) bounded auto-reconnect with exponential backoff. On connect it
calls `Runtime.enable` then probes for a Hermes constraint (see [§3](#3-the-two-hermes-constraints-the-gold)).

---

## 2. Target discovery

### Metro's inspector endpoints

Metro exposes the connected RN runtimes' debug targets over HTTP. The driver fetches **`/json`**;
Sortessori's hand-rolled gate fetches **`/json/list`**. Both return the same shape (an array of debug
targets, each with a `webSocketDebuggerUrl`). See the [drift note](#known-drift-json-vs-jsonlist) below.

Eyeball the targets before debugging anything:

```bash
curl -s http://localhost:8081/json/list | jq '.[] | {title, vm, description, webSocketDebuggerUrl}'
```

### Filtering to the RN runtime target

Metro can list non-RN pages; the driver keeps only true RN/Hermes runtime targets. From
`discoverTargets` in `packages/driver/src/cdp/discovery.ts:34`:

```ts
return targets.filter(
  (t) =>
    t.title?.includes("Hermes") || t.vm === "Hermes" || t.description?.includes("React Native"),
);
```

Three accept conditions, because RN's inspector metadata changed across versions:

- **`title` contains `"Hermes"`** — classic pre-Bridgeless titles.
- **`vm === "Hermes"`** — explicit VM field.
- **`description` contains `"React Native"`** — **Bridgeless RN 0.81+** advertises the runtime in
  `description` (e.g. `"React Native Bridgeless"`), not the title.

> Sortessori's gate filters differently — it matches `title` against a configurable `TARGET_TITLE`
> (default `"sortessori"`), because its app's page title is `xyz.unrulysystems.sortessori (iPhone)`
> rather than a generic "Hermes" string (`scenicSettleGate.mjs:112`, and
> `sortessori/CLAUDE.md`). When writing a new harness, decide deliberately between
> "any Hermes target" (driver behavior) and "the target whose title is my app" (gate behavior).

### Selecting a target

`selectTarget` (`discovery.ts:50`) picks one target by priority: **`deviceId`** (exact) → **`deviceName`**
(case-insensitive substring, also matched against `title`) → **`pageIndex`** (default `0`). It throws a
listing of available targets when nothing matches — fail-loud, not silent. Pass these via `DeviceOptions`:

```ts
const device = createDevice({ deviceName: "<your device name>" }); // or { deviceId }, { pageIndex }
```

With multiple devices/sims connected, **always pin a target** — index `0` is whichever happened to
register first. More patterns in
`docs/ADVANCED.md` ("CDP Targeting").

### Known drift: `/json` vs `/json/list`

The driver (`discovery.ts:25`) fetches **`/json`**; Sortessori's gate (`scenicSettleGate.mjs:111`,
`deviceGate.mjs`, and `apps/sortessori-app/e2e/README.md`) fetches **`/json/list`**. Metro serves both
today, so neither is "wrong," but the inconsistency is real drift: two codebases discover the same
runtime through two endpoints. **Converge on one** (preferably whatever the gate-on-driver convergence
in [§6](#6-known-duplication--the-convergence-plan) settles on) so a future Metro/RN change that drops
one alias only breaks one place. Until then, if discovery returns `[]` unexpectedly, try the *other*
endpoint manually with `curl` before assuming the app isn't connected.

---

## 3. The two Hermes constraints (the gold)

These two are the load-bearing reason RN-over-CDP code looks weird. Internalize both; they are why the
"obvious" `async` + `awaitPromise:true` approach silently fails on a real RN app.

### Constraint 1 — Hermes `Runtime.evaluate` rejects `async`/`await`

Hermes' CDP `Runtime.evaluate` compiler **refuses `async`/`await`**, throwing
`"async functions are unsupported"`. It *does* accept arrow functions, `let`/`const`, template
literals, and `Promise`s. So payloads must be written as **Promise chains**, never `async` IIFEs.

This is why the gate's kick expression builds a `.then()` chain by hand instead of an `async` loop
(`sortessori/apps/sortessori-app/e2e/scenicSettleGate.mjs:171`):

```js
let chain = Promise.resolve()
if (!synchronousDrop) {
  const STEPS = 8
  for (let i = 1; i <= STEPS; i++) {
    chain = chain.then(() => {
      const t = i / STEPS
      s.dispatchPointer('move', block.x + (slot.x - block.x) * t, block.y + (slot.y - block.y) * t)
      return sleep(16)               // sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    })
  }
}
```

The constraint is documented inline in the gate (`scenicSettleGate.mjs:131-140`) and in
`sortessori/CLAUDE.md` ("Hermes/RN CDP gotchas").

### Constraint 2 — RN's `Promise` polyfill defeats `awaitPromise:true`

React Native **replaces the global `Promise` with a polyfill** at startup. CDP's `awaitPromise:true`
only awaits **native** promises; handed the polyfill, it cannot await it and instead **serializes the
polyfill's private fields** (`{_h, _i, _j, _k}`) as the "result." So you cannot await an async result
over CDP the normal way.

The driver probes whether `awaitPromise` is usable at connect time (rather than hardcoding), in
`detectAwaitPromiseSupport`
(`packages/driver/src/cdp/client.ts:209`):

```ts
private async detectAwaitPromiseSupport(): Promise<void> {
  if (this.awaitPromiseChecked) return;
  this.awaitPromiseChecked = true;
  try {
    const result = await this.send("Runtime.evaluate", {
      expression: "Promise.resolve(1)",
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) { this.supportsAwaitPromise = false; return; }
    this.supportsAwaitPromise = true;
  } catch {
    this.supportsAwaitPromise = false;
  }
}
```

> **The probe is exception-based.** It treats *any* non-exception result as "supported" — it does
> **not** verify the returned value is actually `1`, nor inspect for the `{_h, _i, _j, _k}` polyfill
> shape. So the stash path is the robust default for React Native; the probe mainly lets a future Hermes
> that genuinely supports `awaitPromise` take the fast path. (If a runtime ever returned the serialized
> polyfill *without* throwing, this probe would mis-classify it — hardening it to assert `result === 1`
> would close that gap.)

`evaluate()` then dispatches on the probe result (`client.ts:120`):

```ts
async evaluate<T>(expression: string): Promise<T> {
  if (this.supportsAwaitPromise) {
    return this.evaluateWithAwaitPromise<T>(expression); // normal CDP path (non-RN / future Hermes)
  }
  return this.evaluateWithStash<T>(expression);          // the RN workaround
}
```

> **Why a probe (and which path to trust):** the intent is to let a future Hermes that genuinely
> supports `awaitPromise` take the fast path without breaking today's RN. But per the caveat above, the
> probe only catches the *exception* case — so it reliably selects the stash path on RN **only if** RN
> raises a CDP exception for `awaitPromise` rather than returning the serialized polyfill (not
> re-verified here). **Treat the stash path as the source of truth for React Native**: if you ever see
> async-path breakage on RN, the probe mis-classified — harden it to assert `result === 1`, or force the
> stash path. Both code paths exist; do not delete the stash path.

### The kick-and-poll-a-global pattern

The workaround for Constraint 2: **stash the async result on a `globalThis` key, then poll that key
with plain synchronous evaluates.** Send a fast-returning expression that kicks off the async work and
records its completion on a global; never wait on the promise over the wire.

**Driver implementation** — `evaluateWithStash` (`client.ts:148`). It `eval`s the expression; if the
value is thenable it stashes `{done, hasValue, value}` (or `{done, error}`) on a unique
`__CDP_RESULT_<timestamp>_<rand>` key and returns `{ async: true, id }` immediately:

```ts
const resultId = `__CDP_RESULT_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const wrappedExpression = `
  (function() {
    try {
      var value = eval(${JSON.stringify(expression)});
      if (value && typeof value.then === 'function') {
        var id = '${resultId}';
        globalThis[id] = { pending: true };
        value.then(
          function(v) { globalThis[id] = { done: true, hasValue: typeof v !== 'undefined', value: v }; },
          function(e) { globalThis[id] = { done: true, error: e && e.message ? e.message : String(e) }; }
        );
        return { async: true, id: id };
      }
      return { async: false, hasValue: typeof value !== 'undefined', value: value };
    } catch (e) {
      return { async: false, error: e && e.message ? e.message : String(e) };
    }
  })()
`;
```

The synchronous branch returns inline; the async branch hands off to `pollForResult` (`client.ts:247`),
which polls the global at a 10 ms cadence until `done`, deletes the key, and returns the value (or
throws on `error`/timeout):

```ts
private async pollForResult<T>(resultId: string): Promise<T> {
  const startTime = Date.now();
  const timeout = this.options.timeout;
  while (Date.now() - startTime < timeout) {
    const checkExpr = `
      (function() {
        const r = globalThis['${resultId}'];
        if (r && r.done) { delete globalThis['${resultId}']; return r; }
        return { pending: true };
      })()
    `;
    const checkResult = await this.send("Runtime.evaluate", { expression: checkExpr, returnByValue: true });
    // ... unwrap { done, hasValue, value } | { done, error } ...
    await new Promise((resolve) => setTimeout(resolve, 10)); // poll cadence
  }
  await this.send("Runtime.evaluate", { expression: `delete globalThis['${resultId}']`, returnByValue: true });
  throw new Error(`CDP evaluate timed out after ${timeout}ms`);
}
```

**Gate implementation** — the exact same pattern, re-encoded by hand, in `scenicSettleGate.mjs`. The
kick stashes onto a single fixed key `globalThis.__SCENIC_GATE__` (`scenicSettleGate.mjs:147`):

```js
const buildKickExpression = (blockId, slotId, synchronousDrop) => `(() => {
  const finish = (r) => { globalThis.__SCENIC_GATE__ = { done: true, result: r } }
  globalThis.__SCENIC_GATE__ = { done: false }
  // ... synthesize the throw as a Promise chain (Constraint 1) ...
  chain.then(() => {
    s.dispatchPointer('up', releaseX, releaseY)
    return settlePromise.then(
      (settle) => conclude(settle, null),
      (e) => conclude(null, String(e && e.message ? e.message : e)),
    )
  })
  return 'kicked'   // returns immediately — the result lands on the global later
})()`
```

And the runner polls that global synchronously (`scenicSettleGate.mjs:235`):

```js
const polled = await send('Runtime.evaluate', {
  expression: 'globalThis.__SCENIC_GATE__ || { done: false }',
  returnByValue: true,
})
const v = polled.result?.value
if (v && v.done) return v.result
await new Promise((r) => setTimeout(r, 200))   // gate poll cadence
```

> **Two implementations, one pattern.** The driver uses per-call unique keys (`__CDP_RESULT_*`) and a
> 10 ms cadence; the gate uses one fixed key (`__SCENIC_GATE__`, single throw in flight) and 200 ms.
> The fixed-key choice is safe only because the gate runs one throw at a time; a concurrent harness
> **must** use unique keys like the driver, or two in-flight evaluates clobber each other.

---

## 4. Build & environment constraints

### Debug build only — Release has no Hermes inspector

A **Release build renders the scene fine but exposes no Hermes inspector**, so no target ever registers
and `/json/list` (or `/json`) stays empty — there is nothing to attach to. **Only a Debug build works.**

```bash
# Sortessori on the physical phone (sortessori/CLAUDE.md, e2e/README.md):
bunx expo run:ios --configuration Debug --device "<your device name>"
```

This is the single most common "the gate found no target" cause. Cited in `scenicSettleGate.mjs:33-35`,
`apps/sortessori-app/e2e/README.md` (Prerequisites), and `sortessori/CLAUDE.md`. A bare Expo
Debug build (no `expo-dev-client`) auto-connects to the Metro host baked in at build time — no launcher
tap required.

### iOS Simulator: fine for simple scenes, dead-end for rich WebGPU/Dawn

- **Simulator is fine for a simple scene.** Scenic's hello-cube renders and is drivable on the iOS
  simulator (real Hermes + real Dawn, vendored sim slice), which sidesteps the physical-device codesign
  and device→Metro-network human gates (`scenic/CLAUDE.md`, spike #8 evidence).
- **Simulator is a DEAD-END for Sortessori.** Its richer WebGPU/Dawn scene **SIGSEGVs Hermes on a
  `Uint8Array` index** inside a WebGPU/Dawn async path — the app dies before any gate can drive it.
  **Use a physical device for Sortessori.** Cited `scenicSettleGate.mjs:35`,
  `apps/sortessori-app/e2e/README.md` ("Where it can run"), and `sortessori/CLAUDE.md`
  ("What does NOT work for this app").

Rule of thumb: prototype/contract tests on the sim; the real flagship scene on hardware.

### Target registration is flaky on cold launch → poll-with-deadline, relaunch-on-miss

The Hermes target registers a moment *after* launch, and a rapid relaunch can leave `/json/list`
returning `[]` (a real, observed flake). So discovery must **poll with a bounded deadline** and
**relaunch once on a persistent miss** rather than connecting once and giving up.

The gate's bounded poll, `findTarget` (`scenicSettleGate.mjs:106`):

```js
async function findTarget() {
  const deadline = Date.now() + TARGET_POLL_MS  // default 60_000
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`${METRO}/json/list`)).json()
      const matches = targets.filter(
        (t) => t.webSocketDebuggerUrl && (t.title ?? '').toLowerCase().includes(TITLE_FILTER),
      )
      if (matches.length) return matches[matches.length - 1]
    } catch (err) { /* keep polling */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
  fail(`no "${TITLE_FILTER}" Hermes target on ${METRO} within ${TARGET_POLL_MS}ms ...`)
}
```

The upstream `deviceGate.mjs` orchestrator adds the relaunch-on-miss step (preflight → launch → wait,
**relaunching once if `/json/list` stays `[]`** → hand off to the gate); see
`apps/sortessori-app/e2e/README.md` ("the `verify:device-gate` orchestrator"). After connecting, also
allow for WebGPU cold-init: the scene takes ~5-10 s before `__SCENIC__` installs, so the gate polls a
readiness probe for up to 25 s before driving (`scenicSettleGate.mjs:278`). A steady ~49 KB near-black
screenshot during that window is normal, not a fault.

Launch over Wi-Fi via CoreDevice (the device need not be USB-tethered):

```bash
xcrun devicectl device process launch --terminate-existing \
  --device <DEVICE_UDID> xyz.unrulysystems.sortessori
```

### Domain gotcha: assert the semantic settle event, not the physics body flag

When asserting that a thrown object came to rest, assert the **semantic settle event**
(`reason === 'snap'`, `planarSpeed ~0`) — **NOT Rapier's `body.sleeping` flag**, which lags the snap by
a few idle frames and produces flaky timing. Cited `scenicSettleGate.mjs:29`,
`apps/sortessori-app/e2e/README.md` ("How it drives a throw"), and `sortessori/CLAUDE.md`. The
general principle: assert the **app's own meaning-bearing event**, not a lower-level engine state that
trails it.

---

## 5. The layering

Three layers, strictly stacked. Each knows only the one below it:

```
Sortessori app  (apps/sortessori-app — installs window.__SCENIC__ over its real shell scene)
      │  consumes
device.scenic   (@unrulysystems/scenic-native — the 3D __SCENIC__ assertion layer)
      │  built over
device          (@0xbigboss/rn-playwright-driver — CDP transport, renderer-agnostic)
```

- **Driver (transport).** `@0xbigboss/rn-playwright-driver`. Generic RN-over-CDP: connect, `evaluate`,
  locators, pointer, screenshots, lifecycle. No 3D knowledge.
  (`packages/driver/src/device.ts`)
- **`scenic-native` (the 3D assertion layer).** `@unrulysystems/scenic-native` adds `device.scenic` —
  ergonomic locators (`getByTestId`/`getByName`/`getByUuid`) and a flat surface
  (`getBodyState`/`getObjectScreenPosition`/`getObjectScreenBounds`/`hitTest`/`getCapabilities`/
  `waitForReady`) that all compile to `globalThis.__SCENIC__?.…` expressions run through the driver's
  `device.evaluate`. It depends on the driver **structurally only**, via a minimal `ScenicEvaluable`
  type, to avoid a hard build-time coupling:
  `scenic/packages/scenic-native/src/namespace.ts:27`:

  ```ts
  export type ScenicEvaluable = {
    evaluate<T>(expression: string): Promise<T>
    pointer: { tap(x: number, y: number): Promise<void> }
  }
  ```

  Attach it with `withScenic(device)` (`namespace.ts:201`); every call routes through `scenicExpr`
  (`namespace.ts:42`), which builds `globalThis.__SCENIC__?.<method>(...) ?? null` so an
  adapter-omitted surface yields `null` instead of throwing in the device runtime.

- **Sortessori (the consumer).** Installs `window.__SCENIC__` over its real shell scene (via
  `apps/sortessori-app/src/scenic/`) so the owner-manual "#13/#17 throw feel" becomes the deterministic
  gate in `apps/sortessori-app/e2e/scenicSettleGate.mjs`.

**`scenic-playwright` is the web sibling**, not part of this stack: it provides the *same*
`__SCENIC__` assertion contract for web/CDP via a Playwright `Page` and **does not wrap the driver**.
The design is "one assertion library, two drivers" — `scenic-playwright` (web `Page`) and
`scenic-native` (`device`). See `scenic-native/src/namespace.ts:1-10` and `scenic/CLAUDE.md` (Layout).

---

## 6. Known duplication + the convergence plan

The two Hermes constraints from [§3](#3-the-two-hermes-constraints-the-gold) currently live in **three**
places, plus a version drift:

1. **Driver** — `evaluateWithStash` / `pollForResult` / `detectAwaitPromiseSupport`
   (`packages/driver/src/cdp/client.ts`). The canonical,
   probe-guarded implementation.
2. **Sortessori's bespoke `ws` client** — `scenicSettleGate.mjs` re-implements its own WebSocket CDP
   client (`send`/`pending`/message-correlation at lines 202-220) **and** re-encodes the kick-and-poll
   workaround by hand. It does **not** use the driver at all.
3. **Prose** — `sortessori/CLAUDE.md` ("Hermes/RN CDP gotchas") and `apps/sortessori-app/e2e/README.md`,
   plus the inline comment block in `scenicSettleGate.mjs:131-140`. This playbook is intended to
   **supersede them** as the single prose source; leave a one-line pointer there, not a copy.

**Version drift.** The driver package is `@0xbigboss/rn-playwright-driver@0.3.0`
(`packages/driver/package.json`), but the injected harness still reports `version: "0.1.0"`
(`packages/driver/harness/index.ts:509`). This is a stale
constant, not a behavior bug, but it makes the harness version useless for diagnostics. Wire it to the
package version (or a build-time constant) when touching the harness.

**Intended end-state.** The gate should **sit on the driver + `scenic-native`** rather than carry a
fourth hand-rolled CDP client: discovery via the driver's `discoverTargets`/`selectTarget`, transport
via `CDPClient` (whose `evaluate` already encapsulates the kick-and-poll workaround), and assertions via
`device.scenic`. That collapses three implementations of the constraints into one and removes the
`/json` vs `/json/list` drift as a side effect. This is tracked as **the scenicSettleGate convergence
issue** in the Sortessori repo — find it via:

```bash
gh issue list --repo unrulysystems/sortessori --search "scenicSettleGate convergence in:title,body"
```

Until that lands, when fixing a CDP constraint **fix the driver first**, then delete the gate's copy as
part of the convergence — do not patch the gate's bespoke client in isolation and let the two drift
further.

---

## 7. Cross-links

The companion docs across the stack:

- **Scenic architecture** — `unrulysystems/scenic/ARCHITECTURE.md` (contract, install paths, read
  transports, determinism, the WebGPU/Dawn recipe). See also `scenic/VISION.md` (direction) and
  `scenic/CONVERGENCE.md` (the Sortessori×Scenic convergence findings).
- **Sortessori architecture** — `unrulysystems/sortessori/docs/ARCHITECTURE.md` (durable packages +
  the device-gate workflow). See also `sortessori/CLAUDE.md` (operational rules + Hermes/RN CDP
  gotchas), `sortessori/SPEC.md` (`REQ-*`), and `sortessori/ROADMAP.md`.
- **Stack overview** — `unrulysystems/ops/docs/STACK.md` (how all the repos layer; the origins timeline).
- **This driver** — `docs/ADVANCED.md` (CDP targeting,
  timeouts, direct `CDPClient` access) and
  `docs/API-STABILITY.md` (stable vs experimental surface;
  note `CDPClient` is **experimental**).
- **The gate + its prereqs** — `sortessori/apps/sortessori-app/e2e/README.md`
  and `sortessori/apps/sortessori-app/e2e/scenicSettleGate.mjs`.
