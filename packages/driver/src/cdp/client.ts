import WebSocket from 'ws'

export type CDPClientOptions = {
  /** Request timeout in ms (default: 30000) */
  timeout?: number
  /** Auto-reconnect on connection loss (default: false) */
  autoReconnect?: boolean
  /** Maximum reconnect attempts (default: 3) */
  maxReconnectAttempts?: number
  /** Base backoff delay in ms, doubles each attempt (default: 1000) */
  reconnectBackoffMs?: number
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * CDP protocol result type - intentionally loose as CDP responses vary by method.
 */
type CDPResult = {
  result?: { value?: unknown }
  exceptionDetails?: {
    text?: string
    exception?: { description?: string }
  }
  [key: string]: unknown
}

/**
 * Chrome DevTools Protocol client for Hermes runtime.
 */
export class CDPClient {
  private ws: WebSocket | null = null
  private messageId = 0
  private pending = new Map<number, PendingRequest>()
  private options: Required<CDPClientOptions>
  private wsUrl: string | null = null
  private reconnectAttempts = 0
  private isReconnecting = false
  private targetInfo: { id?: string; url?: string } = {}
  private awaitPromiseChecked = false
  private supportsAwaitPromise = false
  // Handlers for CDP events (messages with `method`, no `id`), keyed by method
  // name (e.g. "Runtime.consoleAPICalled"). Persist across reconnects.
  private eventHandlers = new Map<string, Set<(params: Record<string, unknown>) => void>>()

  constructor(options: CDPClientOptions = {}) {
    this.options = {
      timeout: options.timeout ?? 30_000,
      autoReconnect: options.autoReconnect ?? false,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 3,
      reconnectBackoffMs: options.reconnectBackoffMs ?? 1000,
    }
  }

  async connect(wsUrl: string, targetInfo?: { id?: string; url?: string }): Promise<void> {
    this.wsUrl = wsUrl
    this.targetInfo = targetInfo ?? {}
    this.reconnectAttempts = 0
    await this.doConnect()
  }

  private async doConnect(): Promise<void> {
    if (!this.wsUrl) {
      throw new Error('CDP client: no WebSocket URL configured')
    }

    this.ws = new WebSocket(this.wsUrl, { origin: originForWebSocketUrl(this.wsUrl) })

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        cleanup()
        resolve()
      }
      const onError = (err: Error) => {
        cleanup()
        reject(err)
      }
      const cleanup = () => {
        this.ws?.removeListener('open', onOpen)
        this.ws?.removeListener('error', onError)
      }
      this.ws!.on('open', onOpen)
      this.ws!.on('error', onError)
    })

    this.ws.on('message', this.handleMessage.bind(this))
    this.ws.on('close', this.handleClose.bind(this))
    this.ws.on('error', this.handleError.bind(this))

    await this.send('Runtime.enable', {})
    await this.detectAwaitPromiseSupport()
  }

  async disconnect(): Promise<void> {
    // Reject all pending requests
    for (const [, { reject, timer }] of this.pending) {
      clearTimeout(timer)
      reject(new Error('CDP client disconnected'))
    }
    this.pending.clear()

    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.close()
      this.ws = null
    }
  }

  /**
   * Subscribe to a CDP event (a protocol message carrying `method`, e.g.
   * "Runtime.consoleAPICalled"). Returns an unsubscribe function. Handlers
   * persist across auto-reconnects since `Runtime.enable` is re-sent.
   */
  onEvent(method: string, handler: (params: Record<string, unknown>) => void): () => void {
    let handlers = this.eventHandlers.get(method)
    if (!handlers) {
      handlers = new Set()
      this.eventHandlers.set(method, handlers)
    }
    handlers.add(handler)
    return () => {
      this.eventHandlers.get(method)?.delete(handler)
    }
  }

  /** Health check - validates connection is alive */
  async ping(): Promise<boolean> {
    try {
      await this.send('Runtime.evaluate', { expression: '1', returnByValue: true })
      return true
    } catch {
      return false
    }
  }

  async evaluate<T>(expression: string): Promise<T> {
    if (this.supportsAwaitPromise) {
      return this.evaluateWithAwaitPromise<T>(expression)
    }
    return this.evaluateWithStash<T>(expression)
  }

  private async evaluateWithAwaitPromise<T>(expression: string): Promise<T> {
    const wrappedExpression = `
      (async function() {
        return eval(${JSON.stringify(expression)});
      })()
    `

    const result = await this.send('Runtime.evaluate', {
      expression: wrappedExpression,
      returnByValue: true,
      awaitPromise: true,
    })

    if (result.exceptionDetails) {
      throw new Error(this.formatEvaluateError(expression, result.exceptionDetails))
    }

    const value = result.result?.value as T | undefined
    return value as T
  }

  private async evaluateWithStash<T>(expression: string): Promise<T> {
    const resultId = `__CDP_RESULT_${Date.now()}_${Math.random().toString(36).slice(2)}`

    // Detect if expression is a single expression or multiple statements.
    // Multi-statement code contains semicolons outside of strings/parens and needs
    // to be wrapped differently. For robustness, we use eval() which handles both.
    const wrappedExpression = `
      (function() {
        try {
          var value = eval(${JSON.stringify(expression)});
          if (value && typeof value.then === 'function') {
            var id = '${resultId}';
            globalThis[id] = { pending: true };
            value.then(
              function(v) {
                var hasValue = typeof v !== 'undefined';
                globalThis[id] = { done: true, hasValue: hasValue, value: v };
              },
              function(e) {
                globalThis[id] = { done: true, error: e && e.message ? e.message : String(e) };
              }
            );
            return { async: true, id: id };
          }
          var hasValue = typeof value !== 'undefined';
          return { async: false, hasValue: hasValue, value: value };
        } catch (e) {
          return { async: false, error: e && e.message ? e.message : String(e) };
        }
      })()
    `

    const result = await this.send('Runtime.evaluate', {
      expression: wrappedExpression,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(this.formatEvaluateError(expression, result.exceptionDetails))
    }

    type EvaluatePayload =
      | { async: true; id: string }
      | { async: false; hasValue: boolean; value?: T }
      | { async: false; error: string }

    const payload = result.result?.value as EvaluatePayload | undefined
    if (!payload) {
      throw new Error('CDP evaluate failed: empty result')
    }

    if ('error' in payload) {
      throw new Error(`CDP evaluate failed: ${payload.error}`)
    }

    if (payload.async) {
      return this.pollForResult<T>(payload.id)
    }

    return (payload.hasValue ? payload.value : undefined) as T
  }

  private async detectAwaitPromiseSupport(): Promise<void> {
    if (this.awaitPromiseChecked) return
    this.awaitPromiseChecked = true

    try {
      const result = await this.send('Runtime.evaluate', {
        expression: 'Promise.resolve(1)',
        returnByValue: true,
        awaitPromise: true,
      })
      // Sound support means the runtime actually RESOLVED the probe promise to our sentinel (1), not
      // merely that the call returned without a CDP exception. React Native's Promise polyfill makes
      // `awaitPromise: true` resolve to the serialized polyfill object (`{_h, _i, _j, _k}`) WITHOUT
      // raising an exception — so an exception-only probe mis-classifies RN as supported and routes
      // evaluate() to evaluateWithAwaitPromise (which returns garbage on RN) instead of the
      // evaluateWithStash fallback. Asserting the value excludes both that polyfill shape and any
      // other non-resolved result.
      this.supportsAwaitPromise = !result.exceptionDetails && result.result?.value === 1
    } catch {
      this.supportsAwaitPromise = false
    }
  }

  private formatEvaluateError(
    expression: string,
    exceptionDetails: CDPResult['exceptionDetails'],
  ): string {
    const text =
      exceptionDetails?.text ?? exceptionDetails?.exception?.description ?? 'Unknown error'
    const exprSnippet = expression.length > 100 ? `${expression.slice(0, 100)}...` : expression
    const targetDesc = this.targetInfo.url
      ? ` [target: ${this.targetInfo.url}]`
      : this.targetInfo.id
        ? ` [target: ${this.targetInfo.id}]`
        : ''
    return `CDP evaluate failed: ${text}${targetDesc}\nExpression: ${exprSnippet}`
  }

  /**
   * Poll for a result stored in globalThis by evaluate().
   */
  private async pollForResult<T>(resultId: string): Promise<T> {
    const startTime = Date.now()
    const timeout = this.options.timeout

    while (Date.now() - startTime < timeout) {
      const checkExpr = `
        (function() {
          const r = globalThis['${resultId}'];
          if (r && r.done) {
            delete globalThis['${resultId}'];
            return r;
          }
          return { pending: true };
        })()
      `

      const checkResult = await this.send('Runtime.evaluate', {
        expression: checkExpr,
        returnByValue: true,
      })

      if (checkResult.exceptionDetails) {
        const text =
          checkResult.exceptionDetails.text ??
          checkResult.exceptionDetails.exception?.description ??
          'Unknown error'
        throw new Error(`CDP evaluate failed: ${text}`)
      }

      const status = checkResult.result?.value as
        | { pending: true }
        | { done: true; hasValue: boolean; value?: T }
        | { done: true; error: string }

      if (status && 'done' in status && status.done) {
        if ('error' in status) {
          throw new Error(`CDP evaluate failed: ${status.error}`)
        }
        return (status.hasValue ? status.value : undefined) as T
      }

      // Wait a bit before polling again
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    // Cleanup and throw timeout
    await this.send('Runtime.evaluate', {
      expression: `delete globalThis['${resultId}']`,
      returnByValue: true,
    })
    throw new Error(`CDP evaluate timed out after ${timeout}ms`)
  }

  private async send(method: string, params: object): Promise<CDPResult> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('CDP client not connected')
    }

    const id = ++this.messageId

    return new Promise<CDPResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP request timed out after ${this.options.timeout}ms: ${method}`))
      }, this.options.timeout)

      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      this.ws!.send(JSON.stringify({ id, method, params }))
    })
  }

  private handleMessage(data: Buffer) {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(data.toString()) as Record<string, unknown>
    } catch (err) {
      console.error('CDP: Failed to parse message:', err)
      return
    }

    const id = msg.id as number | undefined
    if (id !== undefined && this.pending.has(id)) {
      const { resolve, reject, timer } = this.pending.get(id)!
      clearTimeout(timer)
      this.pending.delete(id)

      // msg.error indicates CDP protocol error (distinct from JS exception)
      const error = msg.error as { message?: string } | undefined
      if (error) {
        reject(new Error(`CDP error: ${error.message ?? JSON.stringify(error)}`))
      } else {
        resolve(msg.result)
      }
      return
    }

    // Events carry `method` and no matching `id` (e.g. Runtime.consoleAPICalled,
    // Runtime.exceptionThrown). Dispatch to subscribers; a throwing handler must
    // not take down the message pump.
    const method = msg.method as string | undefined
    if (method !== undefined) {
      const handlers = this.eventHandlers.get(method)
      if (handlers) {
        const params = (msg.params as Record<string, unknown> | undefined) ?? {}
        for (const handler of handlers) {
          try {
            handler(params)
          } catch (err) {
            console.error(`CDP: event handler for ${method} threw:`, err)
          }
        }
      }
    }
  }

  private handleClose(code: number, reason: Buffer) {
    const reasonStr = reason.toString() || 'unknown'

    // Attempt auto-reconnect if enabled
    if (this.options.autoReconnect && !this.isReconnecting && this.wsUrl) {
      this.attemptReconnect()
      return
    }

    // Reject all pending requests with detailed error
    const targetDesc = this.targetInfo.url
      ? ` (target: ${this.targetInfo.url})`
      : this.targetInfo.id
        ? ` (target: ${this.targetInfo.id})`
        : ''
    const error = new Error(`CDP connection closed: ${code} ${reasonStr}${targetDesc}`)
    for (const [, { reject, timer }] of this.pending) {
      clearTimeout(timer)
      reject(error)
    }
    this.pending.clear()
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      const error = new Error(`CDP reconnect failed after ${this.reconnectAttempts} attempts`)
      for (const [, { reject, timer }] of this.pending) {
        clearTimeout(timer)
        reject(error)
      }
      this.pending.clear()
      return
    }

    this.isReconnecting = true
    this.reconnectAttempts++

    // Exponential backoff
    const delay = this.options.reconnectBackoffMs * 2 ** (this.reconnectAttempts - 1)
    await new Promise((resolve) => setTimeout(resolve, delay))

    try {
      await this.doConnect()
      this.isReconnecting = false
      // Re-enable runtime after reconnect
      await this.send('Runtime.enable', {})
    } catch {
      this.isReconnecting = false
      // Try again
      await this.attemptReconnect()
    }
  }

  private handleError(err: Error) {
    console.error('CDP WebSocket error:', err)
  }
}

function originForWebSocketUrl(wsUrl: string): string {
  const url = new URL(wsUrl)
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  if (url.hostname === 'localhost' || url.hostname === '0.0.0.0') {
    url.hostname = '127.0.0.1'
  }
  return url.origin
}
