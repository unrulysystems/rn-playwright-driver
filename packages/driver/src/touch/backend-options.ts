import type { LongPressOptions } from '../types'

export type TouchBackendOptions = {
  host?: string
  port?: number
  url?: string
  authToken?: string
  connectTimeoutMs?: number
  requestTimeoutMs?: number
}

export type ResolvedTouchBackendOptions = {
  url: string
  authToken?: string
  connectTimeoutMs: number
  requestTimeoutMs: number
}

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 9999
const DEFAULT_CONNECT_TIMEOUT_MS = 2_000
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
const DEFAULT_LONG_PRESS_MS = 500

export function resolveTouchBackendOptions(
  options: TouchBackendOptions | undefined,
  buildUrl: (host: string, port: number) => string,
): ResolvedTouchBackendOptions {
  const host = options?.host ?? DEFAULT_HOST
  const port = options?.port ?? DEFAULT_PORT
  const url = options?.url ?? buildUrl(host, port)
  return {
    url,
    ...(options?.authToken === undefined ? {} : { authToken: options.authToken }),
    connectTimeoutMs: options?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    requestTimeoutMs: options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  }
}

export function resolveLongPressDuration(options: LongPressOptions | undefined): number {
  return options?.duration ?? DEFAULT_LONG_PRESS_MS
}
