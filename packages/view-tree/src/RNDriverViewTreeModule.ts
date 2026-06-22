import { requireNativeModule } from 'expo-modules-core'

import type {
  ElementBounds,
  ElementHandle,
  ElementInfo,
  NativeResult,
  RoleQueryOptions,
  TextQueryOptions,
} from './types'

/**
 * Native module interface for view tree queries.
 */
interface ViewTreeModuleInterface {
  // Single element queries
  findByTestId(testId: string): Promise<NativeResult<ElementInfo>>
  findByText(text: string, exact: boolean): Promise<NativeResult<ElementInfo>>
  findByRole(role: string, name: string | null): Promise<NativeResult<ElementInfo>>

  // Multiple element queries
  findAllByTestId(testId: string): Promise<NativeResult<ElementInfo[]>>
  findAllByText(text: string, exact: boolean): Promise<NativeResult<ElementInfo[]>>
  findAllByRole(role: string, name: string | null): Promise<NativeResult<ElementInfo[]>>

  // Element state
  getBounds(handle: string): Promise<NativeResult<ElementBounds | null>>
  isVisible(handle: string): Promise<NativeResult<boolean>>
  isEnabled(handle: string): Promise<NativeResult<boolean>>
  refresh(handle: string): Promise<NativeResult<ElementInfo | null>>
  tap(handle: string): Promise<NativeResult<boolean>>
}

const NativeModule = requireNativeModule<ViewTreeModuleInterface>('RNDriverViewTree')

/**
 * View tree module for querying and inspecting the native view hierarchy.
 */
export const RNDriverViewTreeModule = {
  /**
   * Find element by testID prop.
   * iOS: matches accessibilityIdentifier
   * Android: matches view tag set by testID
   */
  findByTestId(testId: string): Promise<NativeResult<ElementInfo>> {
    return NativeModule.findByTestId(testId)
  },

  /**
   * Find element by text content.
   * Searches: Text component children, accessibilityLabel
   */
  findByText(text: string, options?: TextQueryOptions): Promise<NativeResult<ElementInfo>> {
    return NativeModule.findByText(text, options?.exact ?? false)
  },

  /**
   * Find element by accessibility role.
   * Maps to accessibilityRole prop.
   */
  findByRole(role: string, options?: RoleQueryOptions): Promise<NativeResult<ElementInfo>> {
    return NativeModule.findByRole(role, options?.name ?? null)
  },

  /**
   * Find all elements by testID prop.
   */
  findAllByTestId(testId: string): Promise<NativeResult<ElementInfo[]>> {
    return NativeModule.findAllByTestId(testId)
  },

  /**
   * Find all elements by text content.
   */
  findAllByText(text: string, options?: TextQueryOptions): Promise<NativeResult<ElementInfo[]>> {
    return NativeModule.findAllByText(text, options?.exact ?? false)
  },

  /**
   * Find all elements by accessibility role.
   */
  findAllByRole(role: string, options?: RoleQueryOptions): Promise<NativeResult<ElementInfo[]>> {
    return NativeModule.findAllByRole(role, options?.name ?? null)
  },

  /**
   * Get current bounds of element by handle.
   * Returns null if element no longer exists.
   */
  getBounds(handle: ElementHandle): Promise<NativeResult<ElementBounds | null>> {
    return NativeModule.getBounds(handle)
  },

  /**
   * Check if element is visible on screen.
   */
  isVisible(handle: ElementHandle): Promise<NativeResult<boolean>> {
    return NativeModule.isVisible(handle)
  },

  /**
   * Check if element is enabled for interaction.
   */
  isEnabled(handle: ElementHandle): Promise<NativeResult<boolean>> {
    return NativeModule.isEnabled(handle)
  },

  /**
   * Refresh element info (re-query by handle).
   */
  refresh(handle: ElementHandle): Promise<NativeResult<ElementInfo | null>> {
    return NativeModule.refresh(handle)
  },

  /**
   * Tap element by handle.
   */
  tap(handle: ElementHandle): Promise<NativeResult<boolean>> {
    return NativeModule.tap(handle)
  },
}
