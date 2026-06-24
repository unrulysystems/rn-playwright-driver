# RN / Hermes CDP E2E Playbook

The canonical home for the hard-won constraints of driving a **React Native app over the Chrome
DevTools Protocol (CDP)**. It exists so the gotchas below stop being re-derived independently in every
RN E2E effort. When a constraint here conflicts with a stray comment elsewhere, **this document wins** —
fix the other site to point here.

Audience: engineers and agents writing or debugging RN E2E over CDP. Voice: third-person, dense,
copy-pasteable. Every claim is grounded in a real file in this repo.

---

## 1. The model: `device` is the RN analog of Playwright's `page`

A test never talks to native UIKit/Android directly. It talks to a **`device`** handle that speaks CDP
to the app's **Hermes VM**, reached through **Metro's inspector proxy**. `device` is to a React Native
app what Playwright's `page` is to a browser tab: the single object you `evaluate` against, locate
elements through, and drive pointer input from.

- Public package: **`@unrulysystems/rn-playwright-driver`** (`packages/driver`).
- The `Device` interface (the stable public surface) is documented in `docs/API-STABILITY.md` —
  `connect`/`disconnect`/`ping`, `evaluate`/`waitForFunction`/`waitForTimeout`, `getBy*` locators,
  `pointer.*`, `screenshot`, lifecycle (`openURL`/`reload`/`background`/`foreground`), `capabilities`,
  and `platform`.
- The concrete implementation is `RNDevice` in `packages/driver/src/device.ts`; construct it with
  `createDevice(options)`.

The driver is **renderer-agnostic** — it knows nothing about three.js, WebGPU, or any physics engine.
It is pure transport plus generic RN affordances (view-tree locators, native touch, screenshots).
Anything renderer-specific is layered on top by a separate package.

The connection flow, from `RNDevice.connect()` (`packages/driver/src/device.ts`):

```ts
async connect(): Promise<void> {
  const metroUrl = this.options.metroUrl ?? DEFAULT_METRO_URL; // http://localhost:8081
  const targets = await discoverTargets(metroUrl);
  const target = selectTarget(targets, this.options);
  this.registerRuntimeEventForwarders();   // before connect — see note in device.ts
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

Metro exposes the connected RN runtimes' debug targets over HTTP. The driver fetches **`/json`**; Metro
also serves the alias **`/json/list`**, and both return the same shape (an array of debug targets, each
with a `webSocketDebuggerUrl`). If discovery returns `[]` unexpectedly, try the _other_ endpoint
manually with `curl` before assuming the app isn't connected.

Eyeball the targets before debugging anything:

```bash
curl -s http://localhost:8081/json/list | jq '.[] | {title, vm, description, webSocketDebuggerUrl}'
```

### Filtering to the RN runtime target

Metro can list non-RN pages; the driver keeps only true RN/Hermes runtime targets. From
`discoverTargets` in `packages/driver/src/cdp/discovery.ts`:

```ts
return targets.filter(
  (t) =>
    t.title?.includes('Hermes') || t.vm === 'Hermes' || t.description?.includes('React Native'),
)
```

Three accept conditions, because RN's inspector metadata changed across versions:

- **`title` contains `"Hermes"`** — classic pre-Bridgeless titles.
- **`vm === "Hermes"`** — explicit VM field.
- **`description` contains `"React Native"`** — **Bridgeless RN 0.81+** advertises the runtime in
  `description` (e.g. `"React Native Bridgeless"`), not the title.

> If your app's inspector page title is the bundle id (e.g. `com.example.app (iPhone)`) rather than a
> generic "Hermes" string, the generic filter above still matches it via `description`/`vm`. A bespoke
> gate that matches `title` against a fixed app name is making a deliberate "the target whose title is
> my app" choice instead of "any Hermes target" — decide which you want.

### Selecting a target

`selectTarget` (`src/cdp/discovery.ts`) picks one target by priority: **`deviceId`** (exact) →
**`deviceName`** (case-insensitive substring, also matched against `title`) → **`pageIndex`** (default
`0`). It throws a listing of available targets when nothing matches — fail-loud, not silent. Pass these
via `DeviceOptions`:

```ts
const device = createDevice({ deviceName: '<your device name>' }) // or { deviceId }, { pageIndex }
```

With multiple devices/sims connected, **always pin a target** — index `0` is whichever happened to
register first. More patterns in `docs/ADVANCED.md` ("CDP Targeting").

---

## 3. The two Hermes constraints (the gold)

These two are the load-bearing reason RN-over-CDP code looks weird. Internalize both; they are why the
"obvious" `async` + `awaitPromise:true` approach silently fails on a real RN app.

### Constraint 1 — Hermes `Runtime.evaluate` rejects `async`/`await`

Hermes' CDP `Runtime.evaluate` compiler **refuses `async`/`await`**, throwing
`"async functions are unsupported"`. It _does_ accept arrow functions, `let`/`const`, template
literals, and `Promise`s. So any payload that needs to sequence async steps must be written as a
**Promise chain**, never an `async` IIFE:

```js
// WORKS on Hermes — explicit Promise chain
let chain = Promise.resolve()
for (let i = 1; i <= STEPS; i++) {
  chain = chain.then(() => {
    doStep(i)
    return new Promise((r) => setTimeout(r, 16)) // sleep
  })
}

// THROWS on Hermes — "async functions are unsupported"
;(async () => {
  for (let i = 1; i <= STEPS; i++) {
    doStep(i)
    await sleep(16)
  }
})()
```

### Constraint 2 — RN's `Promise` polyfill defeats `awaitPromise:true`

React Native **replaces the global `Promise` with a polyfill** at startup. CDP's `awaitPromise:true`
only awaits **native** promises; handed the polyfill, it cannot await it and instead **serializes the
polyfill's private fields** (`{_h, _i, _j, _k}`) as the "result." So you cannot await an async result
over CDP the normal way.

The driver probes whether `awaitPromise` is usable at connect time (rather than hardcoding), in
`detectAwaitPromiseSupport` (`packages/driver/src/cdp/client.ts`):

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
    // Assert the awaited VALUE, not just "no exception": RN can return the
    // serialized {_h,_i,_j,_k} polyfill shape without raising a CDP exception.
    this.supportsAwaitPromise = result.result?.value === 1;
  } catch {
    this.supportsAwaitPromise = false;
  }
}
```

> **The probe asserts the awaited value.** It reports `awaitPromise` supported **only** when the runtime
> genuinely resolves the probe to its sentinel (`result.result?.value === 1`), not merely when the call
> returns without an exception. That excludes both React Native's serialized `{_h, _i, _j, _k}` polyfill
> shape (which RN can return _without_ a CDP exception) and any other non-resolved result, so RN
> deterministically selects the stash path. The stash path remains the robust default for React Native;
> the probe lets a future Hermes that genuinely supports `awaitPromise` take the fast path. (Covered by
> `packages/driver/src/cdp/client.test.ts`: native-supported / exception / serialized-polyfill.)

`evaluate()` then dispatches on the probe result (`src/cdp/client.ts`):

```ts
async evaluate<T>(expression: string): Promise<T> {
  if (this.supportsAwaitPromise) {
    return this.evaluateWithAwaitPromise<T>(expression); // normal CDP path (non-RN / future Hermes)
  }
  return this.evaluateWithStash<T>(expression);          // the RN workaround
}
```

> **Which path to trust:** **treat the stash path as the source of truth for React Native**. Both code
> paths exist; do not delete the stash path. The probe only lets a future Hermes that genuinely supports
> `awaitPromise` take the fast path without breaking today's RN.

### The kick-and-poll-a-global pattern

The workaround for Constraint 2: **stash the async result on a `globalThis` key, then poll that key
with plain synchronous evaluates.** Send a fast-returning expression that kicks off the async work and
records its completion on a global; never wait on the promise over the wire.

`evaluateWithStash` (`src/cdp/client.ts`) `eval`s the expression; if the value is thenable it stashes
`{done, hasValue, value}` (or `{done, error}`) on a unique `__CDP_RESULT_<timestamp>_<rand>` key and
returns `{ async: true, id }` immediately:

```ts
const resultId = `__CDP_RESULT_${Date.now()}_${Math.random().toString(36).slice(2)}`
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
`
```

The synchronous branch returns inline; the async branch hands off to `pollForResult` (`src/cdp/client.ts`),
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

> **Unique keys are mandatory for concurrency.** The driver uses per-call unique keys (`__CDP_RESULT_*`)
> precisely so concurrent in-flight evaluates never clobber each other. A bespoke harness that reuses one
> fixed key is only safe if it guarantees a single evaluate in flight at a time; otherwise two results
> race onto the same global. When in doubt, copy the driver's unique-key approach.

---

## 4. Build & environment constraints

### Debug build only — Release has no Hermes inspector

A **Release build renders the app fine but exposes no Hermes inspector**, so no target ever registers
and `/json` (or `/json/list`) stays empty — there is nothing to attach to. **Only a Debug build works.**

```bash
bunx expo run:ios --configuration Debug --device "<your device name>"
```

This is the single most common "the driver found no target" cause. A bare Expo Debug build (no
`expo-dev-client`) auto-connects to the Metro host baked in at build time — no launcher tap required.

### iOS Simulator: fine for simple scenes, a risk for heavy GPU work

The simulator runs real Hermes and is fine for most apps. But a **graphics-heavy app (WebGPU/Metal)
can crash Hermes on the simulator** inside a GPU async path before any test can drive it — a real,
observed failure mode. Rule of thumb: prototype/contract tests on the sim; verify a heavy GPU scene on
a physical device.

### Target registration is flaky on cold launch → poll-with-deadline, relaunch-on-miss

The Hermes target registers a moment _after_ launch, and a rapid relaunch can leave `/json/list`
returning `[]` (a real, observed flake). So discovery must **poll with a bounded deadline** and, if you
orchestrate launches yourself, **relaunch once on a persistent miss** rather than connecting once and
giving up. A reference bounded poll:

```js
async function findTarget(metro, deadlineMs = 60_000) {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`${metro}/json/list`)).json()
      const matches = targets.filter((t) => t.webSocketDebuggerUrl && isHermesTarget(t))
      if (matches.length) return matches[matches.length - 1]
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`no Hermes target on ${metro} within ${deadlineMs}ms`)
}
```

Launch over Wi-Fi via CoreDevice (the device need not be USB-tethered):

```bash
xcrun devicectl device process launch --terminate-existing --device <DEVICE_UDID> <app-bundle-id>
```

Also allow for cold-init time: a heavy scene may take several seconds before its in-app hooks install,
so poll a readiness probe before driving rather than assuming the app is ready the instant the target
registers.

### Domain gotcha: assert the app's semantic event, not a lower-level engine flag

When asserting that something settled (an animation finished, a thrown object came to rest), assert the
**app's own meaning-bearing event** — not a lower-level engine state that trails it (e.g. a physics
engine's `body.sleeping` flag, which lags the semantic "settled" by a few idle frames and produces
flaky timing). The general principle: assert the event that _means_ what you're testing, not a proxy
that approximates it.

---

## 5. See also

- `docs/ADVANCED.md` — CDP targeting, timeouts, and direct `CDPClient` access.
- `docs/API-STABILITY.md` — stable vs experimental surface (note `CDPClient` is **experimental**).
- `docs/NATIVE-MODULES-ARCHITECTURE.md` — how the driver, harness, and native modules layer.
