import WebSocket from 'ws'

import type { LongPressOptions, Point, PointerEventOptions, TapOptions } from '../types'
import type { TouchBackend } from './backend'
import {
  TouchBackendCommandError,
  TouchBackendError,
  TouchBackendUnavailableError,
} from './backend'
import {
  resolveLongPressDuration,
  resolveTouchBackendOptions,
  type TouchBackendOptions,
} from './backend-options'

export type XCTestBackendOptions = TouchBackendOptions
const PROTOCOL_VERSION = 1

type TouchRequestBase = { id: number; authToken?: string }

type TouchRequest =
  | (TouchRequestBase & { type: 'hello'; protocolVersion: number; client: string })
  | (TouchRequestBase & { type: 'tap'; x: number; y: number })
  | (TouchRequestBase & { type: 'down'; x: number; y: number })
  | (TouchRequestBase & { type: 'move'; x: number; y: number })
  | (TouchRequestBase & { type: 'up' })
  | (TouchRequestBase & { type: 'swipe'; from: Point; to: Point; durationMs: number })
  | (TouchRequestBase & { type: 'longPress'; x: number; y: number; durationMs: number })
  | (TouchRequestBase & { type: 'typeText'; text: string })

type TouchResponse =
  | { id: number; ok: true; result?: unknown }
  | { id: number; ok: false; error: { message: string; code?: string } }

type TouchRequestPayload = TouchRequest extends infer Request
  ? Request extends { id: number }
    ? Omit<Request, 'id'>
    : never
  : never

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

class WsRpcClient {
  private socket: WebSocket | null = null
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private readonly requestTimeoutMs: number
  private readonly authToken: string | undefined

  constructor(requestTimeoutMs: number, authToken?: string) {
    this.requestTimeoutMs = requestTimeoutMs
    this.authToken = authToken
  }

  async connect(url: string, timeoutMs: number): Promise<void> {
    if (this.socket) {
      return
    }

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url)
      const timer = setTimeout(() => {
        socket.close()
        reject(new TouchBackendUnavailableError('xctest', `Timeout connecting to ${url}`))
      }, timeoutMs)

      socket.once('open', () => {
        clearTimeout(timer)
        this.socket = socket
        resolve()
      })

      socket.once('error', (error) => {
        clearTimeout(timer)
        reject(
          new TouchBackendUnavailableError(
            'xctest',
            `Failed to connect to ${url}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        )
      })

      socket.on('message', (data) => {
        this.handleMessage(data)
      })

      socket.on('close', () => {
        this.failAll(new TouchBackendUnavailableError('xctest', 'Connection closed'))
        this.socket = null
      })
    })
  }

  async close(): Promise<void> {
    if (!this.socket) {
      return
    }
    const socket = this.socket
    this.socket = null
    socket.close()
    this.failAll(new TouchBackendUnavailableError('xctest', 'Connection closed'))
  }

  async request(payload: TouchRequestPayload): Promise<unknown> {
    if (!this.socket) {
      throw new TouchBackendUnavailableError('xctest', 'Not connected')
    }

    const id = this.nextId++
    const message: TouchRequest =
      this.authToken === undefined
        ? ({ ...payload, id } as TouchRequest)
        : ({ ...payload, id, authToken: this.authToken } as TouchRequest)

    const responsePromise = new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id)
        reject(new TouchBackendUnavailableError('xctest', `Request timed out (${payload.type})`))
      }, this.requestTimeoutMs)

      this.pending.set(id, { resolve, reject, timeoutId })
    })

    this.socket.send(JSON.stringify(message))
    return responsePromise
  }

  private handleMessage(raw: WebSocket.RawData): void {
    const text = typeof raw === 'string' ? raw : raw.toString('utf8')
    let message: TouchResponse

    try {
      message = JSON.parse(text) as TouchResponse
    } catch {
      this.failAll(new TouchBackendError('xctest', `Invalid JSON message: ${text.slice(0, 200)}`))
      return
    }

    if (!message || typeof message !== 'object' || typeof message.id !== 'number') {
      this.failAll(new TouchBackendError('xctest', `Invalid response shape: ${text.slice(0, 200)}`))
      return
    }

    const pending = this.pending.get(message.id)
    if (!pending) {
      return
    }

    clearTimeout(pending.timeoutId)
    this.pending.delete(message.id)

    if (message.ok) {
      pending.resolve(message.result)
    } else {
      pending.reject(
        new TouchBackendCommandError('xctest', message.error.message, message.error.code),
      )
    }
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeoutId)
      pending.reject(error)
      this.pending.delete(id)
    }
  }
}

export class XCTestTouchBackend implements TouchBackend {
  readonly name = 'xctest' as const
  private readonly url: string
  private readonly connectTimeoutMs: number
  private readonly requestTimeoutMs: number
  private readonly client: WsRpcClient

  constructor(options: XCTestBackendOptions = {}) {
    const resolved = resolveTouchBackendOptions(options, (host, port) => `ws://${host}:${port}`)
    this.url = resolved.url
    this.connectTimeoutMs = resolved.connectTimeoutMs
    this.requestTimeoutMs = resolved.requestTimeoutMs
    this.client = new WsRpcClient(this.requestTimeoutMs, resolved.authToken)
  }

  async init(): Promise<void> {
    await this.client.connect(this.url, this.connectTimeoutMs)
    await this.client.request({
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      client: 'rn-playwright-driver',
    })
  }

  async dispose(): Promise<void> {
    await this.client.close()
  }

  async tap(x: number, y: number, _options?: TapOptions): Promise<void> {
    await this.client.request({ type: 'tap', x, y })
  }

  async down(x: number, y: number, _options?: PointerEventOptions): Promise<void> {
    await this.client.request({ type: 'down', x, y })
  }

  async move(x: number, y: number, _options?: PointerEventOptions): Promise<void> {
    await this.client.request({ type: 'move', x, y })
  }

  async up(_options?: PointerEventOptions): Promise<void> {
    await this.client.request({ type: 'up' })
  }

  async swipe(from: Point, to: Point, durationMs: number): Promise<void> {
    await this.client.request({ type: 'swipe', from, to, durationMs })
  }

  async longPress(x: number, y: number, options: LongPressOptions): Promise<void> {
    const durationMs = resolveLongPressDuration(options)
    await this.client.request({ type: 'longPress', x, y, durationMs })
  }

  async typeText(text: string): Promise<void> {
    await this.client.request({ type: 'typeText', text })
  }
}
