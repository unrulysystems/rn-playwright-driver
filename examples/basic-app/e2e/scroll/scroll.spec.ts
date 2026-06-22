/**
 * E2E tests for the scroll API (device.scroll + Locator.scrollIntoView).
 *
 * Drives the scrollable screen in App.tsx: the `below-fold-target` sits past
 * several filler blocks, well below one viewport height. These tests prove the
 * driver can reach, assert, and screenshot below-the-fold content on a real
 * device — the gap issue #7 was filed for.
 *
 * NOTE: requires RNDriverTouchInjector (native-module touch backend) in the app
 * build, and the scrollable App.tsx screen.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@0xbigboss/rn-playwright-driver/test'

// Durable evidence: where the below-fold screenshot lands. cwd is the package
// root when Playwright runs.
const ARTIFACT_DIR = join(process.cwd(), 'test-results', 'scroll')

test.describe('Scroll API', () => {
  test('scrollIntoView brings a below-the-fold element into view and screenshots it', async ({
    device,
  }) => {
    // Reset to the top so the target is genuinely below the fold regardless of
    // where a prior test left the scroll position (the app is a single live
    // instance shared across tests).
    await device.getByTestId('title').scrollIntoView()

    const metrics = await device.getWindowMetrics()
    const target = device.getByTestId('below-fold-target')

    // Precondition: the target starts below the fold (its top is past the
    // bottom edge of the window). It is rendered (ScrollView keeps children
    // mounted) so bounds() resolves even though it is off-screen.
    const before = await target.bounds()
    expect(before).not.toBeNull()
    expect(before?.y).toBeGreaterThan(metrics.height)

    await target.scrollIntoView()

    // The target is now fully within the viewport.
    const after = await target.bounds()
    expect(after).not.toBeNull()
    expect(after?.y).toBeGreaterThanOrEqual(0)
    expect((after?.y ?? 0) + (after?.height ?? 0)).toBeLessThanOrEqual(metrics.height)
    expect(await target.isVisible()).toBe(true)

    // Below-fold capture works end to end.
    const png = await target.screenshot()
    expect(png.byteLength).toBeGreaterThan(0)
    mkdirSync(ARTIFACT_DIR, { recursive: true })
    writeFileSync(join(ARTIFACT_DIR, 'below-fold-target.png'), png)
  })

  test('device.scroll moves content by a delta and back', async ({ device }) => {
    // Reset near the top so there is room to scroll down, regardless of where a
    // prior test left the scroll position.
    await device.getByTestId('title').scrollIntoView()

    const ref = device.getByTestId('count-display')
    const start = await ref.bounds()
    expect(start).not.toBeNull()

    // dy > 0 scrolls content down → the reference element moves UP (y decreases).
    await device.scroll({ dy: 300 })
    const scrolled = await ref.bounds()
    expect(scrolled).not.toBeNull()
    expect(scrolled?.y).toBeLessThan(start?.y ?? 0)

    // dy < 0 scrolls back up → the reference element moves back DOWN.
    await device.scroll({ dy: -300 })
    const restored = await ref.bounds()
    expect(restored).not.toBeNull()
    expect(restored?.y).toBeGreaterThan(scrolled?.y ?? 0)
  })
})
