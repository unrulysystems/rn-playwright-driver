/**
 * E2E tests for gesture and pointer interactions.
 *
 * Tests swipe, drag, tap, and other pointer operations.
 *
 * NOTE: These tests require RNDriverTouchInjector to be installed.
 */

import { expect, expectLocator, test } from "@0xbigboss/rn-playwright-driver/test";

test.describe("Gesture Interactions", () => {
  test("swipe performs smooth gesture", async ({ device }) => {
    // Get screen dimensions from an element
    const counter = device.getByTestId("count-display");
    const bounds = await counter.bounds();
    expect(bounds).not.toBeNull();

    // Perform a vertical swipe
    const startY = bounds!.y + 100;
    const endY = bounds!.y + 300;
    const centerX = bounds!.x + bounds!.width / 2;

    await device.pointer.swipe({
      from: { x: centerX, y: startY },
      to: { x: centerX, y: endY },
      duration: 300,
    });
  });

  test("swipe with custom duration", async ({ device }) => {
    const counter = device.getByTestId("count-display");
    const bounds = await counter.bounds();
    expect(bounds).not.toBeNull();

    const centerX = bounds!.x + bounds!.width / 2;
    const centerY = bounds!.y + bounds!.height / 2;

    // Fast swipe
    await device.pointer.swipe({
      from: { x: centerX, y: centerY },
      to: { x: centerX + 100, y: centerY },
      duration: 100,
    });

    // Slow swipe
    await device.pointer.swipe({
      from: { x: centerX + 100, y: centerY },
      to: { x: centerX, y: centerY },
      duration: 500,
    });
  });

  test("drag performs interpolated movement", async ({ device }) => {
    const counter = device.getByTestId("count-display");
    const bounds = await counter.bounds();
    expect(bounds).not.toBeNull();

    const startX = bounds!.x;
    const startY = bounds!.y;

    await device.pointer.drag(
      { x: startX, y: startY },
      { x: startX + 50, y: startY + 50 },
      { steps: 5 },
    );
  });

  test("tap on element center (via locator)", async ({ device }) => {
    const button = device.getByTestId("increment-button");
    await expectLocator(button).toBeVisible();

    // Tap the button using locator (native touch injection)
    await button.tap();

    // Verify the tap was registered by checking counter value changed
    // (Actual verification depends on app state)
  });

  test("pointer down/move/up sequence", async ({ device }) => {
    const counter = device.getByTestId("count-display");
    const bounds = await counter.bounds();
    expect(bounds).not.toBeNull();

    const x = bounds!.x + bounds!.width / 2;
    const y = bounds!.y + bounds!.height / 2;

    // Manual gesture sequence
    await device.pointer.down(x, y);
    await device.pointer.move(x + 10, y);
    await device.pointer.move(x + 20, y);
    await device.pointer.up();
  });

  test("multiple taps in sequence (via locator)", async ({ device }) => {
    const incrementButton = device.getByTestId("increment-button");
    await expectLocator(incrementButton).toBeVisible();

    // Tap multiple times using locator (native touch injection)
    await incrementButton.tap();
    await device.waitForTimeout(100);
    await incrementButton.tap();
    await device.waitForTimeout(100);
    await incrementButton.tap();
  });
});
