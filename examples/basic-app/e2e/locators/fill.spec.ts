/**
 * E2E tests for Locator.fill() (#11).
 *
 * fill() resolves its target IN-APP via the React DevTools hook (testID-only)
 * and fires a synthetic change so CONTROLLED inputs commit to React state. That
 * in-app fiber resolution is NOT unit-verifiable (no device, no fibers), so this
 * is the gate that proves it end-to-end.
 *
 * NOTE: requires (same as the other specs here):
 * 1. The RN app running with Metro (bun start)
 * 2. A device/simulator connected with Hermes debugging enabled
 * 3. Native modules installed (view-tree, screenshot, lifecycle)
 *
 * Fixtures (see App.tsx): testID "name-input" (controlled, mirrored by the
 * "name-value" Text), testID "bio-input" (uncontrolled).
 */

import { expect, expectLocator, test } from '@unrulysystems/rn-playwright-driver/test'

test.describe('Locator.fill', () => {
  test('fills a controlled TextInput and commits to React state', async ({ device }) => {
    const input = device.getByTestId('name-input')
    await input.fill('Ada Lovelace')

    // The mirror Text echoes React state — proves the synthetic change fired,
    // not just setNativeProps (which a controlled input's next render overwrites).
    await expectLocator(device.getByTestId('name-value')).toHaveText('Ada Lovelace')
  })

  test('resolves and fills an uncontrolled TextInput', async ({ device }) => {
    // Uncontrolled inputs have no onChangeText; fill() must still RESOLVE them (by
    // component identity) and setNativeProps the value. NOTE: an uncontrolled
    // input has no React-state mirror, so its native value is not assertable
    // headlessly — the value-change coverage is the CONTROLLED tests above (which
    // read the name-value mirror). This case guards that an uncontrolled input is
    // resolved (NOT rejected as not-a-text-input) and fill dispatches without
    // error; verify the on-screen value manually in the attended device session.
    const bio = device.getByTestId('bio-input')
    await bio.fill('hello world')
    // It must still be the same resolvable, visible input after filling.
    await expectLocator(bio).toBeVisible()
  })

  test('replaces existing value rather than appending', async ({ device }) => {
    const input = device.getByTestId('name-input')
    await input.fill('first')
    await input.fill('second')
    await expectLocator(device.getByTestId('name-value')).toHaveText('second')
  })

  // The harness resolves by testID only; unsupported locator shapes must fail
  // loudly (NOT_SUPPORTED) rather than silently filling the first testID match.
  test('rejects an nth() locator with NOT_SUPPORTED', async ({ device }) => {
    await expect(device.getByTestId('name-input').nth(0).fill('x')).rejects.toMatchObject({
      code: 'NOT_SUPPORTED',
    })
  })

  test('rejects a role locator with NOT_SUPPORTED', async ({ device }) => {
    await expect(device.getByRole('textbox').fill('x')).rejects.toMatchObject({
      code: 'NOT_SUPPORTED',
    })
  })
})
