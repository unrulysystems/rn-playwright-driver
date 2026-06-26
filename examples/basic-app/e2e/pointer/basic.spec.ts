/**
 * E2E tests for gesture and pointer interactions.
 *
 * Tests swipe, drag, tap, and other pointer operations.
 *
 * NOTE: These tests require the platform touch companion for the official e2e lanes.
 */

import { expect, expectLocator, test } from '@unrulysystems/rn-playwright-driver/test'

async function getDragStatus(device: {
  evaluate<T>(expression: string): Promise<T>
}): Promise<string> {
  return device.evaluate<string>(
    "globalThis.__RN_DRIVER__.viewTree.findByTestId('drag-status').then(r => r.success ? r.data.text : '')",
  )
}

test.describe('Gesture Interactions', () => {
  test('swipe performs smooth gesture', async ({ device }) => {
    const target = device.getByTestId('drag-target')
    await expectLocator(target).toBeVisible()

    const bounds = await target.bounds()
    expect(bounds).not.toBeNull()

    const startY = bounds!.y + bounds!.height * 0.25
    const endY = bounds!.y + bounds!.height * 0.75
    const centerX = bounds!.x + bounds!.width / 2

    await device.pointer.swipe({
      from: { x: centerX, y: startY },
      to: { x: centerX, y: endY },
      duration: 300,
    })

    await expect.poll(() => getDragStatus(device)).toMatch(/moves:\s*[1-9]\d*/)
  })

  test('swipe with custom duration', async ({ device }) => {
    const target = device.getByTestId('drag-target')
    await expectLocator(target).toBeVisible()

    const bounds = await target.bounds()
    expect(bounds).not.toBeNull()

    const startY = bounds!.y + bounds!.height * 0.25
    const endY = bounds!.y + bounds!.height * 0.75
    const centerX = bounds!.x + bounds!.width / 2

    const duration = 500
    const startedAt = Date.now()

    await device.pointer.swipe({
      from: { x: centerX, y: startY },
      to: { x: centerX, y: endY },
      duration,
      holdStart: 0,
      holdEnd: 0,
    })

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(device.platform === 'ios' ? 150 : 400)
    await expect.poll(() => getDragStatus(device)).toMatch(/Drag:\s*(started|ended)/)
  })

  test('drag performs interpolated movement', async ({ device }) => {
    const counter = device.getByTestId('count-display')
    const bounds = await counter.bounds()
    expect(bounds).not.toBeNull()

    const startX = bounds!.x
    const startY = bounds!.y

    await device.pointer.drag(
      { x: startX, y: startY },
      { x: startX + 50, y: startY + 50 },
      { steps: 5 },
    )
  })

  test('pointer down/move/up sequence', async ({ device }) => {
    const counter = device.getByTestId('count-display')
    const bounds = await counter.bounds()
    expect(bounds).not.toBeNull()

    const x = bounds!.x + bounds!.width / 2
    const y = bounds!.y + bounds!.height / 2

    // Manual gesture sequence
    await device.pointer.down(x, y)
    await device.pointer.move(x + 10, y)
    await device.pointer.move(x + 20, y)
    await device.pointer.up()
  })
})
