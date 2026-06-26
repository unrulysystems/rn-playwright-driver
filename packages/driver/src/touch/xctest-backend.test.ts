import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TouchBackendUnavailableError } from './backend'
import { XCTestTouchBackend } from './xctest-backend'

const wsState = vi.hoisted(() => ({
  instances: [] as Array<{
    url: string
    sent: string[]
    closed: boolean
    emitOpen(): void
    emitError(error: Error): void
    emitMessage(message: unknown): void
    close(): void
  }>,
  MockWebSocket: class {
    readonly url: string
    readonly sent: string[] = []
    closed = false
    private readonly onceHandlers = new Map<string, Array<(...args: unknown[]) => void>>()
    private readonly onHandlers = new Map<string, Array<(...args: unknown[]) => void>>()

    constructor(url: string) {
      this.url = url
      wsState.instances.push(this)
    }

    once(event: string, handler: (...args: unknown[]) => void): this {
      this.addHandler(this.onceHandlers, event, handler)
      return this
    }

    on(event: string, handler: (...args: unknown[]) => void): this {
      this.addHandler(this.onHandlers, event, handler)
      return this
    }

    send(message: string): void {
      this.sent.push(message)
    }

    close(): void {
      this.closed = true
      this.emit('close')
    }

    emitOpen(): void {
      this.emit('open')
    }

    emitError(error: Error): void {
      this.emit('error', error)
    }

    emitMessage(message: unknown): void {
      this.emit('message', typeof message === 'string' ? message : JSON.stringify(message))
    }

    private addHandler(
      handlers: Map<string, Array<(...args: unknown[]) => void>>,
      event: string,
      handler: (...args: unknown[]) => void,
    ): void {
      const existing = handlers.get(event) ?? []
      existing.push(handler)
      handlers.set(event, existing)
    }

    private emit(event: string, ...args: unknown[]): void {
      const onceHandlers = this.onceHandlers.get(event) ?? []
      this.onceHandlers.delete(event)
      for (const handler of [...onceHandlers, ...(this.onHandlers.get(event) ?? [])]) {
        handler(...args)
      }
    }
  },
}))

vi.mock('ws', () => ({
  default: wsState.MockWebSocket,
}))

type MockWebSocket = (typeof wsState.instances)[number]

async function connectBackend(
  options: ConstructorParameters<typeof XCTestTouchBackend>[0] = {},
): Promise<{ backend: XCTestTouchBackend; socket: MockWebSocket }> {
  const backend = new XCTestTouchBackend(options)
  const initPromise = backend.init()
  const socket = wsState.instances[0]
  if (!socket) {
    throw new Error('expected XCTestTouchBackend to open a websocket')
  }
  socket.emitOpen()
  await flushMicrotasks()

  const hello = socket.sent[0]
  if (!hello) {
    throw new Error('expected a hello frame to be sent')
  }
  expect(JSON.parse(hello)).toEqual({
    id: 1,
    type: 'hello',
    protocolVersion: 1,
    client: 'rn-playwright-driver',
    ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
  })
  socket.emitMessage({ id: 1, ok: true })
  await initPromise

  return { backend, socket }
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve()
  }
}

function lastSent(socket: MockWebSocket): unknown {
  return JSON.parse(socket.sent.at(-1) ?? '{}')
}

describe('XCTestTouchBackend', () => {
  beforeEach(() => {
    wsState.instances.length = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('connects to the configured URL and performs the hello handshake', async () => {
    const { socket } = await connectBackend({ host: '127.0.0.2', port: 7777 })

    expect(socket.url).toBe('ws://127.0.0.2:7777')
  })

  it('sends the configured auth token on each request', async () => {
    const { backend, socket } = await connectBackend({ authToken: 'xctest-token' })

    const promise = backend.tap(1, 2)
    expect(lastSent(socket)).toEqual({
      id: 2,
      type: 'tap',
      x: 1,
      y: 2,
      authToken: 'xctest-token',
    })
    socket.emitMessage({ id: 2, ok: true })
    await promise
  })

  it('serializes websocket command payloads with request IDs', async () => {
    const { backend, socket } = await connectBackend({ url: 'ws://companion.test' })

    const commands = [
      { run: () => backend.tap(1, 2), expected: { id: 2, type: 'tap', x: 1, y: 2 } },
      { run: () => backend.down(3, 4), expected: { id: 3, type: 'down', x: 3, y: 4 } },
      { run: () => backend.move(5, 6), expected: { id: 4, type: 'move', x: 5, y: 6 } },
      { run: () => backend.up(), expected: { id: 5, type: 'up' } },
      {
        run: () => backend.swipe({ x: 7, y: 8 }, { x: 9, y: 10 }, 123),
        expected: {
          id: 6,
          type: 'swipe',
          from: { x: 7, y: 8 },
          to: { x: 9, y: 10 },
          durationMs: 123,
        },
      },
      {
        run: () => backend.longPress(11, 12, {}),
        expected: { id: 7, type: 'longPress', x: 11, y: 12, durationMs: 500 },
      },
      {
        run: () => backend.longPress(13, 14, { duration: 750 }),
        expected: { id: 8, type: 'longPress', x: 13, y: 14, durationMs: 750 },
      },
      {
        run: () => backend.typeText('hello'),
        expected: { id: 9, type: 'typeText', text: 'hello' },
      },
    ]

    for (const command of commands) {
      const promise = command.run()
      expect(lastSent(socket)).toEqual(command.expected)
      socket.emitMessage({ id: command.expected.id, ok: true })
      await promise
    }
  })

  it('maps command failure responses to TouchBackendCommandError', async () => {
    const { backend, socket } = await connectBackend()

    const promise = backend.tap(1, 2)
    socket.emitMessage({
      id: 2,
      ok: false,
      error: { message: 'tap failed', code: 'E_TAP' },
    })

    await expect(promise).rejects.toMatchObject({
      backend: 'xctest',
      code: 'E_TAP',
      message: 'tap failed',
      name: 'TouchBackendCommandError',
    })
  })

  it('reports unavailable when commands run before initialization', async () => {
    const backend = new XCTestTouchBackend()

    await expect(backend.tap(1, 2)).rejects.toMatchObject({
      backend: 'xctest',
      message: 'Not connected',
    })
  })

  it('maps websocket connection failures to unavailable errors', async () => {
    const backend = new XCTestTouchBackend({ url: 'ws://companion.test' })
    const initPromise = backend.init()
    const socket = wsState.instances[0]
    if (!socket) {
      throw new Error('expected a websocket instance to be created')
    }
    socket.emitError(new Error('ECONNREFUSED'))

    await expect(initPromise).rejects.toThrow(TouchBackendUnavailableError)
    await expect(initPromise).rejects.toMatchObject({
      backend: 'xctest',
      message: 'Failed to connect to ws://companion.test: ECONNREFUSED',
    })
  })

  it('times out pending requests', async () => {
    vi.useFakeTimers()
    const { backend } = await connectBackend({ requestTimeoutMs: 25 })

    const promise = backend.tap(1, 2)
    const assertion = expect(promise).rejects.toMatchObject({
      backend: 'xctest',
      message: 'Request timed out (tap)',
    })
    await vi.advanceTimersByTimeAsync(25)

    await assertion
  })

  it('rejects pending requests when the socket closes', async () => {
    const { backend, socket } = await connectBackend()

    const promise = backend.tap(1, 2)
    socket.close()

    await expect(promise).rejects.toMatchObject({
      backend: 'xctest',
      message: 'Connection closed',
    })
  })
})
