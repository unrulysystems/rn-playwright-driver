import type { LongPressOptions, Point, PointerEventOptions, TapOptions } from '../types'

export type TouchBackendName = 'xctest' | 'instrumentation' | 'native-module' | 'cli'

export type TouchBackendContext = {
  platform: 'ios' | 'android'
  evaluate<T>(expression: string): Promise<T>
  waitForTimeout(ms: number): Promise<void>
}

export interface TouchBackend {
  readonly name: TouchBackendName
  init(): Promise<void>
  dispose(): Promise<void>
  tap(x: number, y: number, options?: TapOptions): Promise<void>
  down(x: number, y: number, options?: PointerEventOptions): Promise<void>
  move(x: number, y: number, options?: PointerEventOptions): Promise<void>
  up(options?: PointerEventOptions): Promise<void>
  swipe(from: Point, to: Point, durationMs: number): Promise<void>
  longPress(x: number, y: number, options: LongPressOptions): Promise<void>
  typeText(text: string): Promise<void>
}

export class TouchBackendError extends Error {
  readonly backend: TouchBackendName

  constructor(backend: TouchBackendName, message: string) {
    super(message)
    this.name = 'TouchBackendError'
    this.backend = backend
  }
}

export class TouchBackendUnavailableError extends TouchBackendError {
  constructor(backend: TouchBackendName, message: string) {
    super(backend, message)
    this.name = 'TouchBackendUnavailableError'
  }
}

export class TouchBackendCommandError extends TouchBackendError {
  readonly code?: string

  constructor(backend: TouchBackendName, message: string, code?: string) {
    super(backend, message)
    this.name = 'TouchBackendCommandError'
    if (code !== undefined) {
      this.code = code
    }
  }
}

export class TouchBackendNotInitializedError extends TouchBackendError {
  constructor(backend: TouchBackendName) {
    super(backend, 'Touch backend not initialized. Call device.connect() first.')
    this.name = 'TouchBackendNotInitializedError'
  }
}
