export type ErrorCode = 'INTERNAL' | 'NOT_SUPPORTED'

export type NativeResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code: ErrorCode }
