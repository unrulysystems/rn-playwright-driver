/**
 * E2E for `device.files` — host-side sandbox I/O against a real
 * simulator/emulator container.
 *
 * Two kinds of test live here:
 *  - **Host-only** (push/pull round-trips, nested push, missing → NOT_FOUND): the
 *    transports are host-side (simctl/adb) and never touch the RN runtime, so
 *    these need NO in-app affordance and run without waiting on the app.
 *  - **App-affordance oracles** (grouped below): they cross-check that a host root
 *    maps to the app's real expo-file-system directory, so they call into
 *    `__RN_DRIVER_EXAMPLE__` and are gated on its readiness — kept separate so a
 *    mount race can't fail a host-only test for the wrong reason.
 *
 * Runs on iOS simulator + Android emulator via `rn-driver test`, which supplies
 * the RN_APP_BUNDLE_ID / RN_SIM_UDID / RN_APP_PACKAGE targeting env (REQ-TGT-*).
 */
import { randomBytes } from 'node:crypto'
import { expect, test } from '@unrulysystems/rn-playwright-driver/test'

test.describe('device.files', () => {
  test('push then pull round-trips exact bytes (REQ-FILES-002)', async ({ device }) => {
    const name = 'rn-driver-e2e-roundtrip.bin'
    const payload = randomBytes(4096)

    await device.files.push(payload, name)
    const pulled = await device.files.pull(name)

    expect(Buffer.compare(pulled, payload)).toBe(0)
  })

  test("Android 'absolute' root round-trips a full run-as path (REQ-XPORT-004)", async ({
    device,
  }) => {
    // `absolute` is Android-only (unsupported on iOS); exercise the documented
    // public path on a real emulator, not just fake-adb unit coverage. Uses the
    // app-private data dir rather than external storage (e.g. /sdcard): reaching
    // /sdcard needs an external-storage permission this example app does not
    // declare, and `run-as` bounds `absolute` to the app UID either way, so the
    // private-dir path keeps this test deterministic and permission-free.
    test.skip(device.platform !== 'android', "'absolute' root is unsupported on iOS")
    const pkg = process.env.RN_APP_PACKAGE
    test.skip(!pkg, 'RN_APP_PACKAGE not set')

    const abs = `/data/data/${pkg}/files/rn-driver-abs-${randomBytes(4).toString('hex')}.bin`
    const payload = randomBytes(256)

    await device.files.push(payload, abs, { root: 'absolute' })
    const pulled = await device.files.pull(abs, { root: 'absolute' })

    expect(Buffer.compare(pulled, payload)).toBe(0)
  })

  test('push creates intermediate parent directories for a nested path (REQ-FILES-006)', async ({
    device,
  }) => {
    // Exercise the parent-dir contract on the real container: a fresh nested
    // path forces the transport to create the intermediate directories
    // (adb `mkdir -p` / host fs recursive) before the write lands.
    const nested = `rn-driver-e2e/${randomBytes(6).toString('hex')}/nested-roundtrip.bin`
    const payload = randomBytes(2048)

    await device.files.push(payload, nested)
    const pulled = await device.files.pull(nested)

    expect(Buffer.compare(pulled, payload)).toBe(0)
  })

  test('push honors an explicit named root (cache), not just the default document root (REQ-FILES-003)', async ({
    device,
  }) => {
    // A push-with-root regression that ignored FilePushOptions.root would land the
    // bytes in the document root and this cache-root pull would 404 (or read stale
    // bytes). Round-trip through root:'cache' explicitly to catch that.
    const name = `rn-driver-push-cache-${randomBytes(6).toString('hex')}.bin`
    const payload = randomBytes(512)

    await device.files.push(payload, name, { root: 'cache' })
    const pulled = await device.files.pull(name, { root: 'cache' })

    expect(Buffer.compare(pulled, payload)).toBe(0)
  })

  test("push then pull round-trips through the 'data' root (container/home root, REQ-FILES-003)", async ({
    device,
  }) => {
    // The `data` root maps to the container root itself (iOS `<data>`, Android
    // `/data/data/<pkg>`) — the only named root the E2E floor did not exercise. A
    // nested subpath keeps it clear of the document/cache subdirs the other tests use.
    const name = `rn-driver-data/${randomBytes(6).toString('hex')}.bin`
    const payload = randomBytes(384)

    await device.files.push(payload, name, { root: 'data' })
    const pulled = await device.files.pull(name, { root: 'data' })

    expect(Buffer.compare(pulled, payload)).toBe(0)
  })

  test('pull of a missing path fails closed with NOT_FOUND (REQ-FILES-005)', async ({ device }) => {
    // Random per-run name so stale sandbox state can't make this pass/fail for
    // the wrong reason (no remove API to clean a fixed name across runs).
    const missing = `definitely-missing-${randomBytes(8).toString('hex')}.xyz`
    await expect(device.files.pull(missing)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  // These cross-check that a host-side root maps to the app's REAL
  // expo-file-system directory, so they call into the app. The app installs
  // `__RN_DRIVER_EXAMPLE__` inside a `useEffect`, not present the instant CDP
  // attaches — gate on its readiness (only here) so a mount race can't be
  // mistaken for a device.files bug.
  test.describe('app-affordance oracles', () => {
    test.beforeEach(async ({ device }) => {
      // The driver's own polling helper; throws a TimeoutError if it never mounts.
      await device.waitForFunction<boolean>(
        'typeof globalThis.__RN_DRIVER_EXAMPLE__ === "object"',
        { timeout: 15_000, polling: 100 },
      )
    })

    test('a host-pushed file is readable by the app through the document root (REQ-FILES-002/003)', async ({
      device,
    }) => {
      // The host round-trips prove host transport symmetry (push then host-pull),
      // but not that a host `push` lands where the APP's document root actually is.
      // Push host-side, then have the app read it via expo-file-system — a
      // mis-mapped push would 404 or return the wrong bytes app-side.
      const name = 'rn-driver-host-pushed.txt'
      const content = `host-pushed-${randomBytes(8).toString('hex')}`

      await device.files.push(Buffer.from(content), name)

      const appRead = await device.evaluate<string>(
        `globalThis.__RN_DRIVER_EXAMPLE__.readDocumentFile(${JSON.stringify(name)})`,
      )
      expect(appRead).toBe(content)
    })

    test('pull reads a file the app wrote via expo-file-system at the document root (REQ-FILES-003)', async ({
      device,
    }) => {
      // Prove the `document` root maps to the app's real documentDirectory. Have
      // the app write the file itself via expo-file-system, then pull it host-side
      // — a mis-mapped root would 404 or return the wrong bytes.
      const name = 'rn-driver-app-written.txt'
      const content = `app-written-${randomBytes(8).toString('hex')}`

      const uri = await device.evaluate<string>(
        `globalThis.__RN_DRIVER_EXAMPLE__.writeDocumentFile(${JSON.stringify(name)}, ${JSON.stringify(content)})`,
      )
      expect(uri).toContain(name)

      const pulled = await device.files.pull(name, { root: 'document' })
      expect(pulled.toString('utf8')).toBe(content)
    })

    test('pull reads a file the app wrote via expo-file-system at the cache root (REQ-FILES-003)', async ({
      device,
    }) => {
      // Prove the `cache` root maps to the app's real cacheDirectory; a mis-mapped
      // cache root would 404 or return the wrong bytes. Have the app write to
      // Paths.cache, then pull with root:'cache'.
      const name = 'rn-driver-app-cache.txt'
      const content = `app-cache-${randomBytes(8).toString('hex')}`

      const uri = await device.evaluate<string>(
        `globalThis.__RN_DRIVER_EXAMPLE__.writeCacheFile(${JSON.stringify(name)}, ${JSON.stringify(content)})`,
      )
      expect(uri).toContain(name)

      const pulled = await device.files.pull(name, { root: 'cache' })
      expect(pulled.toString('utf8')).toBe(content)
    })
  })
})
