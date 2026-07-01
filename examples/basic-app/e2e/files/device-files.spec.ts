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
  test('push then pull round-trips exact bytes (REQ-FILES-002)', async ({ device }) => {
    const name = 'rn-driver-e2e-roundtrip.bin'
    const payload = randomBytes(4096)

    await device.files.push(payload, name)
    const pulled = await device.files.pull(name)

    expect(Buffer.compare(pulled, payload)).toBe(0)
  })

  test('pull of a missing path fails closed with NOT_FOUND (REQ-FILES-005)', async ({ device }) => {
    await expect(device.files.pull('definitely-missing-file.xyz')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})
