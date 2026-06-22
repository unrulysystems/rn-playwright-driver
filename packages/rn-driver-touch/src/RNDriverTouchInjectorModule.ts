import { requireNativeModule } from 'expo-modules-core'

import type { NativeResult } from './types'

interface TouchInjectorModuleInterface {
  tap(x: number, y: number): Promise<NativeResult<void>>
  down(x: number, y: number): Promise<NativeResult<void>>
  move(x: number, y: number): Promise<NativeResult<void>>
  up(): Promise<NativeResult<void>>
  swipe(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    durationMs: number,
  ): Promise<NativeResult<void>>
  longPress(x: number, y: number, durationMs: number): Promise<NativeResult<void>>
  typeText(text: string): Promise<NativeResult<void>>
}

const NativeModule = requireNativeModule<TouchInjectorModuleInterface>('RNDriverTouchInjector')

export const RNDriverTouchInjectorModule = {
  tap(x: number, y: number): Promise<NativeResult<void>> {
    return NativeModule.tap(x, y)
  },
  down(x: number, y: number): Promise<NativeResult<void>> {
    return NativeModule.down(x, y)
  },
  move(x: number, y: number): Promise<NativeResult<void>> {
    return NativeModule.move(x, y)
  },
  up(): Promise<NativeResult<void>> {
    return NativeModule.up()
  },
  swipe(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    durationMs: number,
  ): Promise<NativeResult<void>> {
    return NativeModule.swipe(fromX, fromY, toX, toY, durationMs)
  },
  longPress(x: number, y: number, durationMs: number): Promise<NativeResult<void>> {
    return NativeModule.longPress(x, y, durationMs)
  },
  typeText(text: string): Promise<NativeResult<void>> {
    return NativeModule.typeText(text)
  },
}
