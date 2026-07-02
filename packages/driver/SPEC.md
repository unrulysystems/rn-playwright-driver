# SPEC — `@unrulysystems/rn-playwright-driver`: Device File I/O

Tracks GitHub issue
[#33](https://github.com/unrulysystems/rn-playwright-driver/issues/33).

## Scope

This SPEC covers the **device file I/O** capability of the driver package
(`device.files.pull` / `device.files.push`) and the runner-side **targeting
context** it depends on. The broader driver behavior (CDP transport, locators,
touch backends, lifecycle) is specced by its code/README; the runner lifecycle
is specced in [`../runner/SPEC.md`](../runner/SPEC.md). New driver capabilities
append `REQ-*` domains to this file.

The targeting requirements (`REQ-TGT-*`) extend the runner's env-var contract
(`../runner/SPEC.md` → "The environment-variable contract"). They are owned here
for this feature and are now also listed in the runner SPEC's env table (drift
reconciled).

## Problem

The driver drives the RN view tree over CDP and synthesizes touch, but it has no
way to read back files the app writes to its sandbox. Many features' real output
is a file, not on-screen UI: a CSV/PDF/HTML data export ends in the native share
sheet (out of the RN tree), so today the only e2e-reachable assertion is "the
export button is visible" — the _bytes_ can only be unit-tested against a mocked
filesystem. The same gap blocks asserting generated caches, downloaded assets,
and persisted snapshots.

Reading the produced file off a real device verifies the **artifact** — the thing
actually worth testing — end to end, without driving any native chrome.

## Solution

A `device.files` namespace that reads/writes the running app's sandbox from the
host via per-platform process transports, returning/accepting host `Buffer`s.

- **iOS simulator** — `xcrun simctl get_app_container <udid> <bundleId> data`
  resolves the container to a host path; the driver reads/writes it directly.
- **iOS device** — `xcrun devicectl device copy from|to` (Xcode 15+) transfers
  the app-data-container file to/from a host temp path. Works only for
  development-signed apps (`get-task-allow`); E2E builds qualify. Shipped
  **provisional** until verified on real hardware.
- **Android (emulator or device)** — one transport: `adb … run-as <pkg> cat`
  (pull) and `run-as <pkg> sh -c 'cat > …'` over stdin (push). This mirrors the
  already-proven runner pattern that writes the auth token and seeds
  `shared_prefs` (`../runner/src/plan/android.ts`). Gated on a debuggable build.

Cross-platform remote paths resolve against **named roots** that mirror
`expo-file-system`, so one call points at the right place on both platforms.

The transports sit behind an injectable `HostFileExec` seam (the same DI pattern
as the `AdbExec` in `src/touch/cli-backend.ts`), so argv construction and error
mapping are unit-tested without spawning real tools.

## Domain model

### API surface (ratified; identifiers exported from `src/types.ts`)

```ts
type FileRoot = 'document' | 'cache' | 'data' | 'absolute' // default: 'document'

interface FilePullOptions {
  root?: FileRoot
  maxBuffer?: number // read memory cap (all transports); default 64 MiB
}
interface FilePushOptions {
  root?: FileRoot
  maxBuffer?: number // source size cap; default 64 MiB
}

interface DeviceFiles {
  pull(remotePath: string, options?: FilePullOptions): Promise<Buffer>
  push(source: string | Buffer, remotePath: string, options?: FilePushOptions): Promise<void>
  // reserved, not v1: exists(), list(), remove()
}

// device.files: DeviceFiles
```

`FileIoError extends Error` with `code`:
`NOT_FOUND | UNAVAILABLE | UNSUPPORTED | TRANSPORT_FAILED | TOO_LARGE`.

### Root resolution

| Root       | iOS (container `<data>`) | Android (`/data/data/<pkg>`) |
| ---------- | ------------------------ | ---------------------------- |
| `document` | `<data>/Documents`       | `/data/data/<pkg>/files`     |
| `cache`    | `<data>/Library/Caches`  | `/data/data/<pkg>/cache`     |
| `data`     | `<data>`                 | `/data/data/<pkg>`           |
| `absolute` | unsupported\*            | path verbatim (device path)  |

`document`/`cache` mirror `expo-file-system`'s `documentDirectory`/
`cacheDirectory`, so a file written by the app via that API is reachable by the
same `device.files` call on both platforms. \*`absolute` is **unsupported on
iOS** (both kinds) and rejects `UNSUPPORTED`: `device.files` is app-sandbox-scoped,
and on the simulator an absolute path would resolve to a raw HOST path — a
sandbox escape with the runner's privileges. On Android `absolute` is an
intentional escape hatch: the path is passed to `run-as <pkg>` **verbatim** (no
path-prefix restriction), so its reach is exactly **whatever the app UID can
access** — the app-private tree (`/data/data/<pkg>/…`) **plus** UID-accessible paths
such as the app's own `/proc/self/…`. It **cannot** reach another app's sandbox or
root/privileged files (the kernel enforces the UID boundary), and — because `run-as`
uses the app's **internal-storage** mount namespace — **external storage is NOT
reachable**: `/sdcard/…`, including the app-scoped `/sdcard/Android/data/<pkg>/…`,
returns Permission denied and fails closed as `TRANSPORT_FAILED`. `..` is rejected
(REQ-XPORT-004) so the touched path stays legible. Input is test-author-controlled,
so this is a deliberate capability, not an injection surface. E2E coverage
round-trips an app-private `absolute` path AND asserts an external-storage path fails
closed (the run-as reach boundary is verified, not just asserted in prose).

### Transport selection

| Platform / kind   | Transport                                         |
| ----------------- | ------------------------------------------------- |
| iOS / `simulator` | `simctl get_app_container` + host `fs`            |
| iOS / `device`    | `devicectl device copy from\|to` + host-tmp stage |
| Android / either  | `adb … run-as <pkg> cat` / `cat >` over stdin     |

### Targeting context (runner → driver)

The driver learns its target from a `DeviceOptions.target` block, defaulted from
env by the Playwright fixture (`src/test.ts` / `src/test-env.ts`). The runner
emits the env; the value of any token/secret is never involved (paths only).

| Variable             | Scope   | Meaning                              |
| -------------------- | ------- | ------------------------------------ |
| `RN_APP_BUNDLE_ID`   | iOS     | App bundle id (`simctl`/`devicectl`) |
| `RN_SIM_UDID`        | iOS     | Simulator/device UDID                |
| `RN_IOS_TARGET_KIND` | iOS     | `simulator` (default) \| `device`    |
| `RN_APP_PACKAGE`     | Android | App package name (`run-as`)          |
| `ANDROID_SERIAL`     | Android | adb device pin (already emitted)     |

The `target` block is **capability-neutral** — native-OS-UI automation (#34) will
reuse `bundleId`/`udid`, so it is not named `files`.

## Requirements

### Device file I/O API — `REQ-FILES-*`

- **REQ-FILES-001** `device.files` exposes `pull(remotePath, options?) →
Promise<Buffer>` and `push(source, remotePath, options?) → Promise<void>`,
  where `source` is a host file path **or** a `Buffer` (generated fixtures).
  `exists`/`list`/`remove` are reserved names, not implemented in v1.
- **REQ-FILES-002** `pull` returns the exact on-device bytes, binary-safe (no
  encoding/normalization). `push` writes the source bytes verbatim.
- **REQ-FILES-003** `options.root ∈ {document, cache, data, absolute}`, default
  `document`. `document`/`cache` resolve per the Root-resolution table and mirror
  `expo-file-system`.
- **REQ-FILES-004** For non-`absolute` roots the remote path joins **under** the
  resolved root; a leading `/` does not escape the root. `absolute` takes the
  path verbatim. Path resolution is deterministic and unit-tested per
  platform × root.
- **REQ-FILES-005** `pull` of a missing path rejects with `FileIoError` code
  `NOT_FOUND`. It never resolves with an empty or partial `Buffer` (fail-closed).
- **REQ-FILES-006** `push` rejects on write failure (unwritable/absent root) with
  a typed error. `push` **creates intermediate parent directories on simctl and
  adb**: adb `mkdir -p` and the host `fs` seam (simctl) are unit-tested to create
  them. **devicectl does NOT create them itself** — the nested container-relative
  path is forwarded verbatim as the `copy to` `--destination` (argv-tested) and
  parent creation is delegated to the tool, a device-side behavior confirmed only by
  the pending real-device walkthrough (iOS-device ships **provisional**), not proven
  by the injected `HostFileExec`. If the tool does not create them, the non-zero exit
  maps to `TRANSPORT_FAILED` (fail-closed), never a silent partial write.
- **REQ-FILES-007** All failures surface as `FileIoError` with a `code`:
  `NOT_FOUND` (missing path), `UNAVAILABLE` (missing targeting context),
  `UNSUPPORTED` (root/transport combination unsupported), `TRANSPORT_FAILED`
  (underlying tool nonzero exit / unparseable output), `TOO_LARGE` (cap
  exceeded). Each carries the normalized underlying message; the three tools'
  differing failure signatures are mapped to this taxonomy.
- **REQ-FILES-008** `pull` is bounded by `options.maxBuffer` (default 64 MiB) on
  **every** transport, never a truncated `Buffer`. Two mechanisms, by transport:
  - **Android** caps the adb stdout **stream**: the exec kills the child once
    stdout exceeds the cap (`HostExecMaxBufferError` → `TOO_LARGE`). The read grants
    a small fixed **headroom** (`READ_DIAGNOSTIC_HEADROOM`, 64 KiB) over `maxBuffer`
    so the trailing sentinel + a missing-file `cat:` diagnostic still fit and get
    parsed; the returned **file bytes are re-checked against `maxBuffer` exactly**
    (`adb.ts`), so the payload cap is `maxBuffer` while the stream ceiling is
    `maxBuffer + 64 KiB`. Capture accumulates chunks then `concat`s — the standard
    stream pattern (no length to pre-size a subprocess pipe from), so a near-cap pull
    sees a transient second copy; hard memory is still bounded by the kill. Control
    commands that omit `maxBuffer` (container lookup, copy, push) are bounded by a
    generous `DEFAULT_STDOUT_CAP` so no exec can buffer stdout unbounded.
  - **iOS** (simctl/devicectl) `stat`s the file/staged payload as a cheap fast-fail,
    then performs a **bounded read** (`readFileBoundedFromDisk`) into a **single**
    buffer sized to the file (capped): a stable read peaks at ≈`filesize+1` ≤
    `maxBuffer + 1` (no chunk-list `concat`, so no ~2x), and a file that **grows or
    is swapped between the probe and the read** (a racing/compromised or merely
    concurrently-written app) triggers a one-time reallocation to the cap and still
    rejects `TOO_LARGE` past it — never exhausting the worker. simctl `stat`s the
    container file **in place** (a simulator container is host-mounted). devicectl
    cannot: a **physical device** container is not host-mounted, so `copy from` stages
    the **whole** remote file to host temp over USB _before_ the size fast-fail — peak
    worker MEMORY is still bounded (`maxBuffer + 1`), but an oversized file costs the
    full USB transfer + temp disk before `TOO_LARGE`. There is no documented devicectl
    remote-stat to fail-fast pre-copy; this is a provisional physical-device
    characteristic (iOS-device ships **provisional**), not a memory-bound violation.
    `push` is bounded symmetrically by the **same** bounded read: a host-file source
    rejects `TOO_LARGE` on the size fast-fail, then the bounded read holds the cap
    even if the file grows past the probe; a `Buffer` source (never probed) is caught
    by a final length re-check. A host-path source is **materialized into one heap
    `Buffer` (≤ `maxBuffer`), not streamed** to the transport: the transports consume
    a whole `Buffer`/stdin payload (adb stdin, simctl/devicectl staged temp), and the
    contract is bounded test fixtures, so a bounded single allocation is the
    deliberate tradeoff — chunked streaming would only matter above the cap, which is
    rejected anyway.

### Transports — `REQ-XPORT-*`

- **REQ-XPORT-001** Transport is selected by `(platform, iOS kind)`: iOS+simulator
  → simctl; iOS+device → devicectl; Android (any kind) → adb run-as.
- **REQ-XPORT-002** iOS-simulator resolves the container via `xcrun simctl
get_app_container <udid> <bundleId> data`, then reads/writes the host path at
  `<container>/<root-subpath>/<remotePath>`. Before dereferencing with host
  privileges it resolves the target through symlinks (the longest existing
  ancestor, since a nested `push` has a not-yet-created tail), rejects
  `UNSUPPORTED` if it escapes the container, and then **rebuilds the operation
  path under that canonical ancestor** so the read/write cannot re-follow a
  symlinked component. The textual no-escape rule (`REQ-FILES-004`) is
  string-only; this closes an app-planted in-container symlink (e.g.
  `Documents/x -> /etc/passwd`) that would otherwise read/write arbitrary host
  files. **Threat model:** `device.files` assumes a _cooperative_ app-under-test
  (the developer's own app); the check closes static symlink escape and shrinks
  the check→use window to a narrow TOCTOU, but it is not a hardened boundary
  against an app deliberately racing the runner on its own container.
- **REQ-XPORT-003** iOS-device uses `xcrun devicectl device copy from|to --device
<udid> --domain-type appDataContainer --domain-identifier <bundleId> --source
<container-relative> --destination <path> --json-output <file>`. `pull` stages
  to a host temp then reads the `Buffer`; `push` writes the `Buffer` to a temp
  then `copy to`. Marked **provisional** (see Risk tags / Open items).
- **REQ-XPORT-004** Android reads/writes the app-private sandbox via `adb …
run-as <pkg>`. `adb exec-out` neither propagates the remote exit code (always 0) nor keeps remote stderr separate (it folds into stdout), so the transport
  trusts **neither** — it signals every outcome on stdout via an explicit
  sentinel. `pull` runs one atomic `sh -c 'cat "<abs>"; printf "<SENTINEL>%d"
$?'`: the bytes are recovered by splitting on the LAST sentinel occurrence, and
  the trailing `cat` exit code decides success — a nonzero code (missing/denied)
  maps to `NOT_FOUND`/`TRANSPORT_FAILED`, never a Buffer of `cat`'s error text,
  and there is no probe/read TOCTOU window. `push` runs `run-as <pkg> sh -c
'mkdir -p "<dir>" && cat > "<abs>" && echo <OK>'` over stdin and requires the
  trailing OK token to confirm the write landed. Paths are absolute
  (`/data/data/<pkg>/…`) and reject shell metacharacters; the package name is
  validated against the reverse-DNS grammar before interpolation (fail-closed).
  The `absolute` root is UID-scoped by `run-as` (not confined to
  `/data/data/<pkg>`; see the Root-resolution note) and rejects `..` so the
  touched path stays legible.
- **REQ-XPORT-005** Container-access denial — Android non-debuggable build (no
  `run-as`) or iOS production-signed app (no container access) — surfaces as
  `UNSUPPORTED`/`TRANSPORT_FAILED` with an actionable message, never a silent
  empty result.
- **REQ-XPORT-006** Transports run through an injectable `HostFileExec` seam, so
  argv and error mapping are asserted in unit tests without spawning real
  `simctl`/`devicectl`/`adb` (mirrors `AdbExec` in `src/touch/cli-backend.ts` and
  its recorder test).
- **REQ-XPORT-007** `absolute` root is unsupported on iOS — **both** simulator
  and device — and rejects `UNSUPPORTED`. `device.files` is app-sandbox-scoped;
  on the simulator an absolute path would be a raw host path (sandbox escape),
  and on a device devicectl is domain-scoped. It is supported only on Android,
  where `run-as` keeps it uid-scoped to the app.

### Targeting context contract — `REQ-TGT-*`

- **REQ-TGT-001** The driver resolves targeting (bundleId/packageName,
  udid/serial, iOS kind) from a `DeviceOptions.target` block; direct
  `createDevice({ target })` is the explicit lower-level path.
- **REQ-TGT-002** The runner extends its env contract with `RN_APP_BUNDLE_ID`,
  `RN_SIM_UDID`, `RN_IOS_TARGET_KIND` (iOS) and `RN_APP_PACKAGE` (Android);
  serial continues via `ANDROID_SERIAL`. (Extends `../runner/SPEC.md` env table.)
- **REQ-TGT-003** The Playwright fixture (`src/test.ts` / `src/test-env.ts`) maps
  those env vars into `DeviceOptions.target`.
- **REQ-TGT-004** A file op with missing required targeting context for the active
  platform rejects with `FileIoError` code `UNAVAILABLE`, naming the missing
  field. The driver does not guess udid/bundleId/package.
- **REQ-TGT-005** iOS `kind` defaults to `simulator` when unset (back-compat with
  the current simulator-only runs).
- **REQ-TGT-006** The `target` block is capability-neutral and reusable by the
  native-OS-UI feature (#34); it is not file-scoped.

## Invariants

- A `push` then `pull` of the same root+path on a writable root returns a `Buffer`
  byte-identical to the pushed bytes.
- No file op silently returns empty or partial data; every failure is a typed
  `FileIoError` rejection.
- Transports are pure-argv over an injected exec: identical inputs ⇒ identical
  argv; no transport constructs a command from un-normalized user input that
  could escape the resolved root.
- The driver reaches the app/device only through documented channels: CDP for app
  state, the companion for touch (and #34 native-UI), host-exec for files. File
  I/O adds no new iOS host-exec beyond these transports.
- The driver/runner inject no secret/token material into file-I/O argv, stdin, or
  logs (remote paths may be logged; the auth-token flow is separate). Note this
  bounds only the harness: `push` intentionally moves caller-supplied bytes
  (Buffer or host file) over stdin/staging, so a caller pushing secret fixture
  data is responsible for that content — the transport does not inspect it.

## Non-goals (v1)

- Physical **iOS run orchestration** (build/sign/install/launch, CDP-over-USB).
  The runner stays simulator-only; the iOS-device _transport_ is provided and is
  exercised against externally-wired devices. Full physical-iOS E2E in the runner
  is a separate, tracked effort.
- App-Store/production-signed app containers — inaccessible by design; correctly
  fail-closed.
- Recursive directory copy, globbing, sync, or file watching — single-file
  `pull`/`push` only in v1 (the tools support dirs; deferred).
- `exists`/`list`/`remove` — reserved on the namespace, not implemented.
- Non-debuggable Android builds.
- Helpers for Android shared/external storage beyond what `run-as`/`adb pull`
  already allow.

## Risk tags

- **Public API / package surface (medium):** new `device.files` surface on the
  published driver. Additive, but a contract — SPEC + plan approval (this gate).
- **Provisional transport (medium):** the iOS-device `devicectl` path ships
  unverified-on-hardware. It is labeled **provisional** in docs and stays so until
  a real-device walkthrough passes (test-realism). Unit-verified before ship.
- **Cross-package contract (low):** the runner env extension (`REQ-TGT-002`) is
  reflected in `../runner/SPEC.md`'s env table (in sync).
- **Outward-facing (boundary):** publishing, version bumps, PRs, issue
  edits/closing — all human (repo policy).

## Acceptance criteria

Implementation-time gates (not satisfied by this SPEC; tracked for the build):

- [x] `device.files.pull`/`push` typed and exported; `FileIoError` taxonomy
      implemented (`REQ-FILES-001/002/007`).
- [x] Root resolution unit-tested for every root × platform, incl. the no-escape
      rule for non-`absolute` roots (`REQ-FILES-003/004`).
- [x] Transport argv **and** error mapping unit-tested via an injected
      `HostFileExec` recorder for all three transport implementations (simctl,
      devicectl, adb — the last covering both pull and push), including the
      `devicectl` from/to argv (`REQ-XPORT-*`).
- [x] Fail-closed cases asserted: missing path → `NOT_FOUND`; `maxBuffer` overflow
      → `TOO_LARGE`; missing targeting context → `UNAVAILABLE`; `absolute` on
      iOS → `UNSUPPORTED` (`REQ-FILES-005/008`, `REQ-TGT-004`, `REQ-XPORT-007`).
- [x] e2e in `examples/basic-app`: the app writes a file via `expo-file-system`,
      a test `pull`s it and asserts the bytes for the `document` **and** `cache`
      roots, on an iOS **simulator** and an Android **emulator** (the independent
      oracle) (`REQ-XPORT-002/004`).
- [x] `push` → `pull` byte round-trip e2e on simulator + emulator (incl. a nested
      remote path exercising parent-dir creation).
- [x] Runner env contract extended; `planIos`/`planAndroid` (or env-builder) tests
      assert the new vars; the fixture maps them into `target`
      (`REQ-TGT-002/003`).
- [ ] Android **physical** verified on an attached debuggable device (manual
      walkthrough) — **pending** (no attached device in CI).
- [x] iOS-device `devicectl` transport unit-verified and shipped **provisional**;
      a real-device walkthrough is recorded as pending, not blocking ship.
- [x] `nub run check` green (typecheck + lint + format + unit tests).
- [x] README documents `device.files`, the roots table, per-platform support, and
      the provisional iOS-device note.

## Open items

- The iOS-device transport stays **provisional** pending hardware verification;
  promote to verified once a real-device E2E passes.
- **iOS CDP/file-I/O keying:** CDP attachment pins by `RN_DEVICE_NAME` (exact
  name/title match preferred, substring fallback — so `iPhone 17` resolves to
  `iPhone 17` even alongside `iPhone 17 Pro`) while `device.files` pins by
  `RN_SIM_UDID`. A live check confirmed Metro
  exposes **no device UDID** in its CDP targets — only a name/title — so CDP
  cannot be pinned by UDID (emitting `RN_DEVICE_ID=simUdid` would match nothing
  and regress attach). With **duplicate simulator names** on a shared Metro, the
  two identities could otherwise diverge (evaluate in one runtime, pull another
  sim's container). `selectTarget` now **fails closed on that ambiguity**: more
  than one runtime matching the name throws rather than silently taking the first
  (`cdp/discovery.ts`). Use a **unique simulator name** to disambiguate. In the
  runner flow this is moot — it boots one sim on its own Metro. The **programmatic**
  path has a parallel guard: a direct `createDevice({ target })` pins `device.files`
  but supplies no CDP selector, so when more than one runtime is connected
  `selectTarget` fails closed (`filePinned`) rather than defaulting CDP to the first
  target while file I/O targets another — pass `deviceName`/`pageIndex` to resolve.
  **Single-runtime residual (accepted):** with exactly one connected runtime, a
  file-pinned `createDevice({ target })` with no CDP selector connects CDP to that
  sole runtime — it is the only runtime that exists, so there is nothing safer to
  fail toward, and demanding a redundant selector would break the common
  single-device pin-by-UDID setup. We still cannot **prove** the sole runtime is the
  pinned device (same Metro-no-UDID limitation), so an operator targeting a specific
  device among several booted ones must pass an explicit `deviceName` to bind both
  identities. Revisit (fail closed even for one runtime, at that UX cost) only if
  `device.files` is ever pointed at an untrusted multi-device host.
  **App-identity facet — accepted residual; auto-disambiguation is UNSOUND (do not
  reintroduce).** CDP selects by device name / pageIndex while `device.files` carries the
  app bundle/package pinned to a specific `udid`/`serial`, so on a shared multi-runtime
  Metro the two could in principle diverge (evaluate app A, file I/O app B). The root
  cause is structural: **nothing Metro exposes on a Hermes target maps to the pinned
  `udid`/`serial`.** The available fields are `deviceName`, `title`, and `appId` (the iOS
  bundleId / Android package) — none is a device identity. Two "clever"
  auto-disambiguation shortcuts were tried and BOTH reverted:
  - **`appId` as a selector/tie-break (reverted, unsound):** `appId` proves APP identity,
    not the pinned DEVICE. iOS `bundleId` and Android `packageName` are routinely the SAME
    string (`com.acme.app`) → cross-platform mis-bind; and exact `deviceName` equality
    does NOT prove same device (two simulators can share a name), so an `appId` tie-break
    among same-named targets can pick a runtime on a DIFFERENT device than the pin.
  - **exact-only `deviceName` under a pin (reverted, breaks reality):** rejecting the
    substring fallback broke the real runner flow — Metro reports Android names with a
    suffix (`RN_DEVICE_NAME=sdk_gphone64_arm64` vs Metro `sdk_gphone64_arm64 - 15 - API
35`), so the pinned Android target ONLY resolves by substring. Substring is therefore
    REQUIRED; the safety bound is that exact is PREFERRED and a substring match must be
    UNIQUE (multiple → `Ambiguous device target`).

  So CDP selection under a pin is **operator-directed, not auto-cross-checked**: an
  explicit `deviceName` (exact preferred, else unique substring) or `pageIndex` is honored
  as the caller's deliberate choice; with no selector and >1 runtime it FAILS CLOSED
  (`Ambiguous CDP target`). Duplicate exact names also fail closed. The residual — a
  fuzzy/stale name uniquely substring-matching a different device than the pin, or two RN
  apps on one named device — is left to the operator (`pageIndex`), because no Metro field
  can prove the pinned device identity. The confused deputy is further bounded because a
  usable file target always carries the pin and the no-selector guard fails closed.

- Wireless adb (`ip:port` serials) is assumed handled transparently by
  `ANDROID_SERIAL`; confirm during TDD.
- **iOS-simulator containment TOCTOU (accepted residual).** `resolveInsideContainer`
  validates the canonical path, then `pull`/`push` operate on it by path — a
  check→use window an app _racing its own test runner_ could exploit (REQ-XPORT-002
  threat model). Portable Node cannot close it: there is no atomic resolve-then-open
  (`openat2`/`RESOLVE_BENEATH` is Linux-only and unexposed by Node). It is hardened
  (canonical-path rebuild + post-read length re-check) and **accepted as a documented
  residual** for a cooperative-app dev tool — not a hardened boundary against an app
  deliberately racing the runner. Revisit only if `device.files` is ever pointed at
  an untrusted app (would require a native `openat2`/FD-`O_NOFOLLOW` transport).

## Traceability

Unit floors are green and the E2E floor **passes** on the iOS **simulator** and
Android **emulator** (the independent oracle: app-written `document`/`cache`
reads + push→pull round-trips, incl. a nested path). Still pending: the
**physical**-hardware walkthroughs (iOS-device `devicectl`, Android device), which
share the tested transports but are not exercised in CI. Paths are relative to
`packages/`.

| REQ                   | Test                                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-FILES-001/002     | `driver/src/files/device-files.test.ts`; e2e `examples/basic-app/e2e/files/device-files.spec.ts`                                                         |
| REQ-FILES-003         | `driver/src/files/roots.test.ts` ("named roots")                                                                                                         |
| REQ-FILES-004         | `driver/src/files/roots.test.ts` ("no-escape rule")                                                                                                      |
| REQ-FILES-005         | `driver/src/files/device-files.test.ts` (NOT_FOUND); e2e spec                                                                                            |
| REQ-FILES-006         | `driver/src/files/device-files.test.ts` (push); transport push tests                                                                                     |
| REQ-FILES-007         | `driver/src/files/device-files.test.ts`; `.../transports/*.test.ts`                                                                                      |
| REQ-FILES-008         | adb `adb.test.ts` (stdout cap); iOS `simctl.test.ts`/`devicectl.test.ts` (bounded read + mid-read grow); push `device-files.test.ts` + `host-fs.test.ts` |
| REQ-XPORT-001         | `driver/src/files/transports/index.test.ts`                                                                                                              |
| REQ-XPORT-002         | `driver/src/files/transports/simctl.test.ts`                                                                                                             |
| REQ-XPORT-003 (prov.) | `driver/src/files/transports/devicectl.test.ts`                                                                                                          |
| REQ-XPORT-004         | `driver/src/files/transports/adb.test.ts`                                                                                                                |
| REQ-XPORT-005         | `adb.test.ts` / `simctl.test.ts` (error classification)                                                                                                  |
| REQ-XPORT-006         | all `driver/src/files/transports/*.test.ts` (injected exec, no spawn)                                                                                    |
| REQ-XPORT-007         | `device-files.test.ts` (absolute on iOS sim + device) + `simctl.ts` guard + `devicectl.test.ts`                                                          |
| REQ-TGT-001/004/005   | `driver/src/files/target.test.ts`                                                                                                                        |
| REQ-TGT-002           | `runner/src/plan/env.test.ts`                                                                                                                            |
| REQ-TGT-003           | `driver/src/test-env.test.ts` (`targetFromEnv`)                                                                                                          |
| `device.files` wiring | `driver/src/files/device-wiring.test.ts` (fail-closed pre-connect)                                                                                       |
