import { requireNativeModule } from 'expo-modules-core'

import type { ElementBounds, NativeResult } from './types'

/**
 * Native module interface for screenshots.
 */
interface ScreenshotModuleInterface {
  captureScreen(): Promise<NativeResult<string>>
  captureElement(handle: string): Promise<NativeResult<string>>
  captureRegion(x: number, y: number, width: number, height: number): Promise<NativeResult<string>>
}

const NativeModule = requireNativeModule<ScreenshotModuleInterface>('RNDriverScreenshot')

/**
 * Screenshot module for capturing screen and element screenshots.
 *
 * The captureElement function uses a shared handle registry with the
 * view-tree module to resolve element handles and capture them natively.
 */
export const RNDriverScreenshotModule = {
  /**
   * Capture full screen screenshot.
   * Returns base64-encoded PNG.
   */
  captureScreen(): Promise<NativeResult<string>> {
    return NativeModule.captureScreen()
  },

  /**
   * Capture screenshot of specific element.
   * Returns base64-encoded PNG of the element.
   *
   * The handle is resolved via a shared registry with the view-tree module,
   * allowing native element capture without going through the harness bridge.
   */
  captureElement(handle: string): Promise<NativeResult<string>> {
    return NativeModule.captureElement(handle)
  },

  /**
   * Capture screenshot of specific region.
   * Bounds are in logical points.
   */
  captureRegion(bounds: ElementBounds): Promise<NativeResult<string>> {
    return NativeModule.captureRegion(bounds.x, bounds.y, bounds.width, bounds.height)
  },
}
