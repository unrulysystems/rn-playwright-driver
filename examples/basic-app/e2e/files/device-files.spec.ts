/**
 * E2E for `device.files` — host-side sandbox I/O against a real
 * simulator/emulator container.
 *
 * A push → pull round-trip is the faithful, self-contained oracle: it needs no
 * in-app affordance (the transports are host-side — simctl/adb — and never go
 * through the RN runtime), yet it exercises the real container path end to end.
 * Push random bytes into the app's document root, pull them back, assert exact
 * equality; then assert a missing path fails closed with NOT_FOUND.
 *
 * Runs on iOS simulator + Android emulator via `rn-driver test`, which supplies
 * the RN_APP_BUNDLE_ID / RN_SIM_UDID / RN_APP_PACKAGE targeting env (REQ-TGT-*).
 */
import { randomBytes } from 'node:crypto'
import { expect, test } from '@unrulysystems/rn-playwright-driver/test'

test.describe('device.files', () => {
  // The app installs `__RN_DRIVER_EXAMPLE__` inside a `useEffect`, so it is not
  // present the instant CDP attaches. Gate every test on its readiness so an
  // app-affordance call can't fail for a mount race instead of a device.files bug.
  test.beforeEach(async ({ device }) => {
    const deadline = Date.now() + 15_000
    for (;;) {
      const kind = await device.evaluate<string>('typeof globalThis.__RN_DRIVER_EXAMPLE__')
      if (kind === 'object') return
      if (Date.now() > deadline) {
        throw new Error('__RN_DRIVER_EXAMPLE__ was not installed within 15s (app not mounted?)')
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  })

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
    // public path on a real emulator, not just fake-adb unit coverage. The path
    // must stay inside the app sandbox that `run-as` can reach.
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

  test('a host-pushed file is readable by the app through the document root (REQ-FILES-002/003)', async ({
    device,
  }) => {
    // The round-trips above prove host transport symmetry (push then host-pull),
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
    // The round-trip above proves host transport symmetry but not that the
    // `document` root maps to the app's real documentDirectory. Have the app
    // write the file itself via expo-file-system, then pull it host-side — a
    // mis-mapped root would 404 or return the wrong bytes.
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
    // The document-root oracle above does not prove the `cache` root maps to the
    // app's real cacheDirectory; a mis-mapped cache root would 404 or return the
    // wrong bytes. Have the app write to Paths.cache, then pull with root:'cache'.
    const name = 'rn-driver-app-cache.txt'
    const content = `app-cache-${randomBytes(8).toString('hex')}`

    const uri = await device.evaluate<string>(
      `globalThis.__RN_DRIVER_EXAMPLE__.writeCacheFile(${JSON.stringify(name)}, ${JSON.stringify(content)})`,
    )
    expect(uri).toContain(name)

    const pulled = await device.files.pull(name, { root: 'cache' })
    expect(pulled.toString('utf8')).toBe(content)
  })

  test('pull of a missing path fails closed with NOT_FOUND (REQ-FILES-005)', async ({ device }) => {
    // Random per-run name so stale sandbox state can't make this pass/fail for
    // the wrong reason (no remove API to clean a fixed name across runs).
    const missing = `definitely-missing-${randomBytes(8).toString('hex')}.xyz`
    await expect(device.files.pull(missing)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})
