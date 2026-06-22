import { requireNativeModule } from 'expo-modules-core'

import type { AppState, NativeResult } from './types'

/**
 * Native module interface for lifecycle control.
 */
interface LifecycleModuleInterface {
  openURL(url: string): Promise<NativeResult<void>>
  reload(): Promise<NativeResult<void>>
  background(): Promise<NativeResult<void>>
  foreground(): Promise<NativeResult<void>>
  getState(): Promise<NativeResult<AppState>>
}

const NativeModule = requireNativeModule<LifecycleModuleInterface>('RNDriverLifecycle')

/**
 * Lifecycle module for controlling app state and navigation.
 */
export const RNDriverLifecycleModule = {
  /**
   * Open a URL in the app.
   * Handles deep links and universal links.
   */
  openURL(url: string): Promise<NativeResult<void>> {
    return NativeModule.openURL(url)
  },

  /**
   * Reload the JavaScript bundle.
   */
  reload(): Promise<NativeResult<void>> {
    return NativeModule.reload()
  },

  /**
   * Move app to background.
   */
  background(): Promise<NativeResult<void>> {
    return NativeModule.background()
  },

  /**
   * Bring app to foreground.
   */
  foreground(): Promise<NativeResult<void>> {
    return NativeModule.foreground()
  },

  /**
   * Get current app state.
   */
  getState(): Promise<NativeResult<AppState>> {
    return NativeModule.getState()
  },
}
