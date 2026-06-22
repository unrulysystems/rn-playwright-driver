/**
 * RN Driver Harness - Install in your React Native app
 *
 * Usage:
 *   import '@0xbigboss/rn-playwright-driver/harness';
 *
 * This creates global.__RN_DRIVER__ with native module bridges,
 * tracing, and utility helpers.
 */

import type {
  ElementBounds,
  ElementHandle,
  ElementInfo,
  NativeResult,
} from '@0xbigboss/rn-driver-shared-types'
import type {
  AppState,
  Capabilities,
  DriverEvent,
  DriverEventType,
  TracingOptions,
  WindowMetrics,
} from './shared-types'

export type {
  ElementBounds,
  ElementHandle,
  ElementInfo,
  ErrorCode,
  NativeResult,
} from '@0xbigboss/rn-driver-shared-types'
export type {
  AppState,
  Capabilities,
  DriverEvent,
  DriverEventType,
  TracingOptions,
  WindowMetrics,
} from './shared-types'

/**
 * View tree bridge interface.
 */
export type ViewTreeBridge = {
  findByTestId: (testId: string) => Promise<NativeResult<ElementInfo>>
  findByText: (text: string, exact?: boolean) => Promise<NativeResult<ElementInfo>>
  findByRole: (role: string, name?: string | null) => Promise<NativeResult<ElementInfo>>
  findAllByTestId: (testId: string) => Promise<NativeResult<ElementInfo[]>>
  findAllByText: (text: string, exact?: boolean) => Promise<NativeResult<ElementInfo[]>>
  findAllByRole: (role: string, name?: string | null) => Promise<NativeResult<ElementInfo[]>>
  getBounds: (handle: ElementHandle) => Promise<NativeResult<ElementBounds | null>>
  isVisible: (handle: ElementHandle) => Promise<NativeResult<boolean>>
  isEnabled: (handle: ElementHandle) => Promise<NativeResult<boolean>>
  refresh: (handle: ElementHandle) => Promise<NativeResult<ElementInfo | null>>
  tap: (handle: ElementHandle) => Promise<NativeResult<boolean>>
}

/**
 * Screenshot bridge interface.
 */
export type ScreenshotBridge = {
  captureScreen: () => Promise<NativeResult<string>>
  captureElement: (handle: ElementHandle) => Promise<NativeResult<string>>
  captureRegion: (bounds: ElementBounds) => Promise<NativeResult<string>>
}

/**
 * Lifecycle bridge interface.
 */
export type LifecycleBridge = {
  openURL: (url: string) => Promise<NativeResult<void>>
  reload: () => Promise<NativeResult<void>>
  background: () => Promise<NativeResult<void>>
  foreground: () => Promise<NativeResult<void>>
  getState: () => Promise<NativeResult<AppState>>
}

/**
 * Native touch injection bridge interface.
 */
export type TouchNativeBridge = {
  tap: (x: number, y: number) => Promise<NativeResult<void>>
  down: (x: number, y: number) => Promise<NativeResult<void>>
  move: (x: number, y: number) => Promise<NativeResult<void>>
  up: () => Promise<NativeResult<void>>
  swipe: (
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    durationMs: number,
  ) => Promise<NativeResult<void>>
  longPress: (x: number, y: number, durationMs: number) => Promise<NativeResult<void>>
  typeText: (text: string) => Promise<NativeResult<void>>
}

/**
 * Global driver interface exposed on global.__RN_DRIVER__.
 */
export type RNDriverGlobal = {
  /** View tree native module bridge (Phase 3) */
  viewTree: ViewTreeBridge

  /** Screenshot native module bridge (Phase 3) */
  screenshot: ScreenshotBridge

  /** Lifecycle native module bridge (Phase 3) */
  lifecycle: LifecycleBridge

  /** Feature detection */
  capabilities: Capabilities

  /** Native touch injection bridge (Phase 2.5) */
  touchNative: TouchNativeBridge

  // --- Core Primitives ---

  /**
   * Get current window metrics (dimensions, pixel ratio, orientation).
   * All values are in logical points.
   */
  getWindowMetrics: () => WindowMetrics

  /**
   * Get current RAF frame count.
   * Monotonically increasing counter incremented each requestAnimationFrame.
   */
  getFrameCount: () => number

  /**
   * Start tracing driver events.
   * Events are stored in a bounded ring buffer.
   */
  startTracing: (options?: TracingOptions) => void

  /**
   * Stop tracing and return collected events.
   * Clears the trace buffer.
   */
  stopTracing: () => { events: DriverEvent[] }

  /**
   * Check if tracing is currently active.
   */
  isTracing: () => boolean

  /**
   * Add a trace event (used by driver to inject evaluate events).
   * Only adds event if tracing is active.
   */
  traceEvent: (type: DriverEventType, data?: Record<string, unknown>) => void

  /** Internal state (for debugging) */
  _internal: {
    frameCount: number
    tracing: {
      active: boolean
      events: DriverEvent[]
      includeConsole: boolean
      maxEvents: number
    }
  }
}

// Extend global type
declare global {
  // eslint-disable-next-line no-var
  var __RN_DRIVER__: RNDriverGlobal | undefined
}

/**
 * Try to require a native module, returning null if not available.
 */
function tryRequireNativeModule<T>(moduleName: string): T | null {
  try {
    // Dynamic require for Expo modules
    const { requireNativeModule } = require('expo-modules-core')
    const mod = requireNativeModule(moduleName) as T
    if (__DEV__) {
      console.log(`[RN_DRIVER] Loaded native module: ${moduleName}`)
    }
    return mod
  } catch (error) {
    if (__DEV__) {
      console.warn(`[RN_DRIVER] Failed to load ${moduleName}:`, error)
    }
    return null
  }
}

/**
 * Module installation instructions for error messages.
 */
const MODULE_INSTALL_INSTRUCTIONS: Record<string, string> = {
  RNDriverViewTree:
    'RNDriverViewTree module not installed. Install @0xbigboss/rn-driver-view-tree and rebuild your app.',
  'RNDriverViewTree.tap':
    'RNDriverViewTree.tap not available. Update @0xbigboss/rn-driver-view-tree and rebuild your app.',
  RNDriverScreenshot:
    'RNDriverScreenshot module not installed. Install @0xbigboss/rn-driver-screenshot and rebuild your app.',
  'RNDriverScreenshot.captureElement':
    'RNDriverScreenshot.captureElement not available. Update @0xbigboss/rn-driver-screenshot and rebuild your app.',
  RNDriverLifecycle:
    'RNDriverLifecycle module not installed. Install @0xbigboss/rn-driver-lifecycle and rebuild your app.',
  RNDriverTouchInjector:
    'RNDriverTouchInjector module not installed. Install @0xbigboss/rn-driver-touch and rebuild your app.',
}

const HARNESS_API_VERSION = 1

/**
 * Create error result for unavailable modules.
 */
function notSupportedResult<T>(feature: string): NativeResult<T> {
  const errorMessage =
    MODULE_INSTALL_INSTRUCTIONS[feature] ?? `${feature} native module not installed.`
  return {
    success: false,
    error: errorMessage,
    code: 'NOT_SUPPORTED',
  }
}

/**
 * Create and install the driver harness.
 */
function installHarness(): void {
  // Don't reinstall if already present (allows HMR)
  if (global.__RN_DRIVER__) {
    return
  }

  // RAF frame counter - monotonically increasing
  let frameCount = 0
  let rafId: number | null = null

  // Start the RAF counter loop
  function startRafCounter(): void {
    if (rafId !== null) return

    const tick = (): void => {
      frameCount++
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
  }

  // Start RAF counter immediately
  startRafCounter()

  // Tracing state
  const MAX_TRACE_EVENTS = 1000
  const tracingState = {
    active: false,
    events: [] as DriverEvent[],
    includeConsole: false,
    maxEvents: MAX_TRACE_EVENTS,
  }

  /**
   * Add an event to the trace buffer (if tracing is active).
   */
  function traceEvent(type: DriverEventType, data?: Record<string, unknown>): void {
    if (!tracingState.active) return

    const event: DriverEvent =
      data !== undefined ? { type, timestamp: Date.now(), data } : { type, timestamp: Date.now() }

    tracingState.events.push(event)

    // Ring buffer: remove oldest events if over limit
    while (tracingState.events.length > tracingState.maxEvents) {
      tracingState.events.shift()
    }
  }

  // Try to load native modules
  type ViewTreeNative = ViewTreeBridge

  type ScreenshotNative = {
    captureScreen: () => Promise<NativeResult<string>>
    captureElement: (handle: ElementHandle) => Promise<NativeResult<string>>
    captureRegion: (
      x: number,
      y: number,
      width: number,
      height: number,
    ) => Promise<NativeResult<string>>
  }

  type LifecycleNative = LifecycleBridge
  type TouchNativeModule = TouchNativeBridge

  const viewTreeNative = tryRequireNativeModule<ViewTreeNative>('RNDriverViewTree')
  const screenshotNative = tryRequireNativeModule<ScreenshotNative>('RNDriverScreenshot')
  const lifecycleNative = tryRequireNativeModule<LifecycleNative>('RNDriverLifecycle')
  const touchNativeModule = tryRequireNativeModule<TouchNativeModule>('RNDriverTouchInjector')

  const viewTreeTapSupported = typeof viewTreeNative?.tap === 'function'
  const screenshotCaptureElementSupported = typeof screenshotNative?.captureElement === 'function'

  // Create bridges with fallback error handling and tracing
  const viewTree: ViewTreeBridge = viewTreeNative
    ? {
        findByTestId: (testId) => {
          traceEvent('locator:find', { method: 'findByTestId', testId })
          return viewTreeNative.findByTestId(testId)
        },
        findByText: (text, exact = false) => {
          traceEvent('locator:find', { method: 'findByText', text, exact })
          return viewTreeNative.findByText(text, exact)
        },
        findByRole: (role, name) => {
          traceEvent('locator:find', { method: 'findByRole', role, name })
          return viewTreeNative.findByRole(role, name ?? null)
        },
        findAllByTestId: (testId) => {
          traceEvent('locator:find', { method: 'findAllByTestId', testId })
          return viewTreeNative.findAllByTestId(testId)
        },
        findAllByText: (text, exact = false) => {
          traceEvent('locator:find', { method: 'findAllByText', text, exact })
          return viewTreeNative.findAllByText(text, exact)
        },
        findAllByRole: (role, name) => {
          traceEvent('locator:find', { method: 'findAllByRole', role, name })
          return viewTreeNative.findAllByRole(role, name ?? null)
        },
        getBounds: (handle) => viewTreeNative.getBounds(handle),
        isVisible: (handle) => viewTreeNative.isVisible(handle),
        isEnabled: (handle) => viewTreeNative.isEnabled(handle),
        refresh: (handle) => viewTreeNative.refresh(handle),
        tap: async (handle) => {
          traceEvent('locator:tap', { handle })
          if (!viewTreeTapSupported) {
            return notSupportedResult('RNDriverViewTree.tap')
          }
          return viewTreeNative.tap(handle)
        },
      }
    : {
        findByTestId: async (testId) => {
          traceEvent('locator:find', { method: 'findByTestId', testId })
          return notSupportedResult('RNDriverViewTree')
        },
        findByText: async (text, exact) => {
          traceEvent('locator:find', { method: 'findByText', text, exact })
          return notSupportedResult('RNDriverViewTree')
        },
        findByRole: async (role, name) => {
          traceEvent('locator:find', { method: 'findByRole', role, name })
          return notSupportedResult('RNDriverViewTree')
        },
        findAllByTestId: async (testId) => {
          traceEvent('locator:find', { method: 'findAllByTestId', testId })
          return notSupportedResult('RNDriverViewTree')
        },
        findAllByText: async (text, exact) => {
          traceEvent('locator:find', { method: 'findAllByText', text, exact })
          return notSupportedResult('RNDriverViewTree')
        },
        findAllByRole: async (role, name) => {
          traceEvent('locator:find', { method: 'findAllByRole', role, name })
          return notSupportedResult('RNDriverViewTree')
        },
        getBounds: async () => notSupportedResult('RNDriverViewTree'),
        isVisible: async () => notSupportedResult('RNDriverViewTree'),
        isEnabled: async () => notSupportedResult('RNDriverViewTree'),
        refresh: async () => notSupportedResult('RNDriverViewTree'),
        tap: async (handle) => {
          traceEvent('locator:tap', { handle })
          return notSupportedResult('RNDriverViewTree')
        },
      }

  // captureElement uses native captureElement when available (shared handle registry),
  // with fallback to viewTree.getBounds + captureRegion for older installations
  const captureElementFallback = async (handle: ElementHandle): Promise<NativeResult<string>> => {
    if (!screenshotNative) {
      return notSupportedResult('RNDriverScreenshot')
    }

    if (typeof screenshotNative.captureRegion !== 'function') {
      return notSupportedResult('RNDriverScreenshot')
    }

    if (!viewTreeNative) {
      return notSupportedResult('RNDriverViewTree')
    }

    const boundsResult = await viewTreeNative.getBounds(handle)
    if (!boundsResult.success) {
      return boundsResult as NativeResult<string>
    }

    const bounds = boundsResult.data
    if (bounds === null) {
      return {
        success: false,
        error: `Element not found for handle: ${handle}`,
        code: 'NOT_FOUND',
      }
    }

    return screenshotNative.captureRegion(bounds.x, bounds.y, bounds.width, bounds.height)
  }

  const captureElementBridge = async (handle: ElementHandle): Promise<NativeResult<string>> => {
    if (!screenshotNative) {
      return notSupportedResult('RNDriverScreenshot')
    }

    if (!screenshotCaptureElementSupported) {
      return captureElementFallback(handle)
    }

    // Try native captureElement first (uses shared handle registry with view-tree module)
    const nativeResult = await screenshotNative.captureElement(handle)
    if (nativeResult.success) {
      return nativeResult
    }

    // If native captureElement failed with NOT_SUPPORTED (old module version), fall back
    // Otherwise return the error (e.g., NOT_FOUND means stale handle)
    if (!nativeResult.success && nativeResult.code !== 'NOT_SUPPORTED') {
      return nativeResult
    }

    return captureElementFallback(handle)
  }

  const screenshot: ScreenshotBridge = screenshotNative
    ? {
        captureScreen: () => screenshotNative.captureScreen(),
        captureElement: captureElementBridge,
        captureRegion: (bounds) =>
          screenshotNative.captureRegion(bounds.x, bounds.y, bounds.width, bounds.height),
      }
    : {
        captureScreen: async () => notSupportedResult('RNDriverScreenshot'),
        captureElement: async () => notSupportedResult('RNDriverScreenshot'),
        captureRegion: async () => notSupportedResult('RNDriverScreenshot'),
      }

  const lifecycle: LifecycleBridge = lifecycleNative
    ? {
        openURL: (url) => lifecycleNative.openURL(url),
        reload: () => lifecycleNative.reload(),
        background: () => lifecycleNative.background(),
        foreground: () => lifecycleNative.foreground(),
        getState: () => lifecycleNative.getState(),
      }
    : {
        openURL: async () => notSupportedResult('RNDriverLifecycle'),
        reload: async () => notSupportedResult('RNDriverLifecycle'),
        background: async () => notSupportedResult('RNDriverLifecycle'),
        foreground: async () => notSupportedResult('RNDriverLifecycle'),
        getState: async () => notSupportedResult('RNDriverLifecycle'),
      }

  const touchNative: TouchNativeBridge = touchNativeModule
    ? {
        tap: (x, y) => {
          traceEvent('pointer:tap', { x, y })
          return touchNativeModule.tap(x, y)
        },
        down: (x, y) => {
          traceEvent('pointer:down', { x, y })
          return touchNativeModule.down(x, y)
        },
        move: (x, y) => {
          traceEvent('pointer:move', { x, y })
          return touchNativeModule.move(x, y)
        },
        up: () => {
          traceEvent('pointer:up')
          return touchNativeModule.up()
        },
        swipe: (fromX, fromY, toX, toY, durationMs) =>
          touchNativeModule.swipe(fromX, fromY, toX, toY, durationMs),
        longPress: (x, y, durationMs) => touchNativeModule.longPress(x, y, durationMs),
        typeText: (text) => touchNativeModule.typeText(text),
      }
    : {
        tap: async () => notSupportedResult('RNDriverTouchInjector'),
        down: async () => notSupportedResult('RNDriverTouchInjector'),
        move: async () => notSupportedResult('RNDriverTouchInjector'),
        up: async () => notSupportedResult('RNDriverTouchInjector'),
        swipe: async () => notSupportedResult('RNDriverTouchInjector'),
        longPress: async () => notSupportedResult('RNDriverTouchInjector'),
        typeText: async () => notSupportedResult('RNDriverTouchInjector'),
      }

  const capabilities: Capabilities = {
    apiVersion: HARNESS_API_VERSION,
    viewTree: viewTreeNative !== null,
    viewTreeTap: viewTreeTapSupported,
    screenshot: screenshotNative !== null,
    screenshotCaptureElement: screenshotCaptureElementSupported,
    lifecycle: lifecycleNative !== null,
    touchNative: touchNativeModule !== null,
  }

  const harness: RNDriverGlobal = {
    viewTree,
    screenshot,
    lifecycle,
    touchNative,
    capabilities,

    // --- Core Primitives ---

    getWindowMetrics(): WindowMetrics {
      // Dynamically import Dimensions and PixelRatio to avoid RN-specific issues
      // at module load time in non-RN environments
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Dimensions, PixelRatio } = require('react-native')
        const { width, height } = Dimensions.get('window')
        const pixelRatio = PixelRatio.get()
        const fontScale = PixelRatio.getFontScale()
        const orientation = width > height ? 'landscape' : 'portrait'

        // Try to get safe area insets if available
        let safeAreaInsets: WindowMetrics['safeAreaInsets']
        try {
          // Check for react-native-safe-area-context
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const safeArea = require('react-native-safe-area-context')
          if (safeArea.initialWindowMetrics?.insets) {
            safeAreaInsets = safeArea.initialWindowMetrics.insets
          }
        } catch {
          // Safe area context not installed, leave undefined
        }

        const result: WindowMetrics = {
          width,
          height,
          pixelRatio,
          scale: pixelRatio,
          fontScale,
          orientation,
        }
        if (safeAreaInsets !== undefined) {
          result.safeAreaInsets = safeAreaInsets
        }
        return result
      } catch {
        // Fallback for non-RN environments (testing, etc.)
        return {
          width: 0,
          height: 0,
          pixelRatio: 1,
          scale: 1,
          fontScale: 1,
          orientation: 'portrait',
        }
      }
    },

    getFrameCount(): number {
      return frameCount
    },

    startTracing(options?: TracingOptions): void {
      tracingState.active = true
      tracingState.events = []
      tracingState.includeConsole = options?.includeConsole ?? false

      // If console tracing is enabled, patch console methods
      if (tracingState.includeConsole) {
        patchConsoleForTracing()
      }
    },

    stopTracing(): { events: DriverEvent[] } {
      const events = [...tracingState.events]
      tracingState.active = false
      tracingState.events = []

      // Restore console if it was patched
      restoreConsole()

      return { events }
    },

    isTracing(): boolean {
      return tracingState.active
    },

    traceEvent,

    _internal: {
      get frameCount() {
        return frameCount
      },
      tracing: tracingState,
    },
  }

  // Console patching for tracing
  type ConsoleMethodName = 'log' | 'warn' | 'error' | 'info'
  type ConsoleSnapshot = Record<ConsoleMethodName, typeof console.log>
  let originalConsole: ConsoleSnapshot | null = null

  function patchConsoleForTracing(): void {
    if (originalConsole) return

    originalConsole = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      info: console.info.bind(console),
    }

    const createPatchedMethod =
      (method: ConsoleMethodName) =>
      (...args: unknown[]): void => {
        originalConsole?.[method](...args)
        const message = args.map((a) => String(a)).join(' ')
        traceEvent('console', { level: method, message })
        // Also emit error event for console.error calls
        if (method === 'error') {
          traceEvent('error', { source: 'console', message })
        }
      }

    console.log = createPatchedMethod('log')
    console.warn = createPatchedMethod('warn')
    console.error = createPatchedMethod('error')
    console.info = createPatchedMethod('info')
  }

  function restoreConsole(): void {
    if (!originalConsole) return

    console.log = originalConsole.log
    console.warn = originalConsole.warn
    console.error = originalConsole.error
    console.info = originalConsole.info
    originalConsole = null
  }

  global.__RN_DRIVER__ = harness

  if (__DEV__) {
    console.log('[RN_DRIVER] Harness installed', {
      capabilities,
    })
  }
}

// __DEV__ is declared globally in src/globals.d.ts; requestAnimationFrame is the RN runtime's
declare function requestAnimationFrame(callback: (timestamp: number) => void): number

// Install immediately on import
installHarness()
