import { vi } from 'vitest'
import { Pointer } from './pointer'
import type { TouchBackend } from './touch'

export type MockTouchBackend = TouchBackend & {
  tap: ReturnType<typeof vi.fn>
  down: ReturnType<typeof vi.fn>
  move: ReturnType<typeof vi.fn>
  up: ReturnType<typeof vi.fn>
  swipe: ReturnType<typeof vi.fn>
  longPress: ReturnType<typeof vi.fn>
  typeText: ReturnType<typeof vi.fn>
  init: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

export type TimeoutProvider = {
  waitForTimeout(ms: number): Promise<void>
}

export const FRAME_MS = 16

export function createPointerHarness(): {
  pointer: Pointer
  mockBackend: MockTouchBackend
  mockTimeoutProvider: TimeoutProvider
} {
  const mockBackend: MockTouchBackend = {
    name: 'native-module',
    init: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    tap: vi.fn().mockResolvedValue(undefined),
    down: vi.fn().mockResolvedValue(undefined),
    move: vi.fn().mockResolvedValue(undefined),
    up: vi.fn().mockResolvedValue(undefined),
    swipe: vi.fn().mockResolvedValue(undefined),
    longPress: vi.fn().mockResolvedValue(undefined),
    typeText: vi.fn().mockResolvedValue(undefined),
  }

  const mockTimeoutProvider: TimeoutProvider = {
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
  }

  return {
    pointer: new Pointer(mockBackend, mockTimeoutProvider),
    mockBackend,
    mockTimeoutProvider,
  }
}
