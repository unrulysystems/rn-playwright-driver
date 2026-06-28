/**
 * Repro for the connect-window event-loss gap.
 *
 * `RNDevice.connect()` calls `cdp.connect()` (which sends `Runtime.enable`
 * internally) and only AFTER it returns registers its console/exception
 * forwarders via `onEvent`. Any CDP event the runtime emits in that window —
 * between `Runtime.enable` going out and the forwarder being subscribed — is
 * delivered to `handleMessage` with no handler registered for its method and is
 * dropped silently.
 *
 * This file proves the mechanism with the REAL `CDPClient.connect()` (real
 * `Runtime.enable` + `detectAwaitPromiseSupport` round-trips) driven by a fake
 * socket that emits a `Runtime.consoleAPICalled` event the moment it processes
 * `Runtime.enable` — i.e. squarely inside the window. The only variable between
 * the two cases is WHEN the caller subscribes: after connect (today's
 * RNDevice ordering → dropped) vs. before connect (the fix direction →
 * captured). Same socket, same event, opposite outcome — that isolates the gap
 * to subscription ordering and nothing else.
 */
import { describe, expect, it, vi } from 'vitest'

const wsState = vi.hoisted(() => ({
  constructorCalls: [] as Array<{ url: string; options: unknown }>,
}))

// A fake `ws` socket: opens on the next microtask, answers `Runtime.enable` and
// `Runtime.evaluate` (the await-promise probe), and — crucially — emits a
// console event while handling `Runtime.enable`, simulating the app logging in
// the post-enable window. EventEmitter is imported inside the factory because
// vi.mock is hoisted above the file's imports.
vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events')
  class FakeWebSocket extends EventEmitter {
    static OPEN = 1
    readyState = FakeWebSocket.OPEN

    constructor(url: string, options: unknown) {
      super()
      wsState.constructorCalls.push({ url, options })
      // Open asynchronously so doConnect's `on('open')` listener is registered
      // before the event fires (mirrors a real socket handshake).
      queueMicrotask(() => this.emit('open'))
    }

    send(data: string): void {
      const msg = JSON.parse(data) as { id: number; method: string }
      queueMicrotask(() => {
        if (msg.method === 'Runtime.enable') {
          // An event lands in the window, BEFORE the enable response resolves
          // connect()'s await. With no subscriber yet, it is dropped here.
          this.emit(
            'message',
            Buffer.from(
              JSON.stringify({
                method: 'Runtime.consoleAPICalled',
                params: { type: 'log', args: [{ value: 'in-window' }] },
              }),
            ),
          )
          this.emit('message', Buffer.from(JSON.stringify({ id: msg.id, result: {} })))
          return
        }
        if (msg.method === 'Runtime.evaluate') {
          // The await-promise probe expects result.result.value === 1.
          this.emit(
            'message',
            Buffer.from(JSON.stringify({ id: msg.id, result: { result: { value: 1 } } })),
          )
          return
        }
        this.emit('message', Buffer.from(JSON.stringify({ id: msg.id, result: {} })))
      })
    }

    close(): void {
      this.readyState = 3
      this.emit('close', 1000, Buffer.from(''))
    }
  }
  return { default: FakeWebSocket }
})

import { CDPClient } from './client'

const WS_URL = 'ws://localhost:8081/debugger'

describe('CDPClient connect-window event loss', () => {
  it('sends an Origin header compatible with React Native inspector proxy checks', async () => {
    const client = new CDPClient()

    await client.connect('ws://localhost:8081/inspector/debug?device=1&page=1')

    expect(wsState.constructorCalls.at(-1)).toEqual({
      url: 'ws://localhost:8081/inspector/debug?device=1&page=1',
      options: { origin: 'http://127.0.0.1:8081' },
    })
    await client.disconnect()
  })

  it('DROPS an event emitted before the caller subscribes (today RNDevice ordering)', async () => {
    const client = new CDPClient()
    const received: Array<Record<string, unknown>> = []

    // connect() sends Runtime.enable; the fake socket emits the console event
    // in that window. RNDevice subscribes only AFTER connect() resolves.
    await client.connect(WS_URL)
    client.onEvent('Runtime.consoleAPICalled', (p) => received.push(p))

    expect(received).toHaveLength(0)
    await client.disconnect()
  })

  it('CAPTURES the same event when the caller subscribes before connect (the fix)', async () => {
    const client = new CDPClient()
    const received: Array<Record<string, unknown>> = []

    // Register the forwarder BEFORE Runtime.enable goes out. onEvent only
    // populates a handler map (no socket needed), so this is always safe.
    client.onEvent('Runtime.consoleAPICalled', (p) => received.push(p))
    await client.connect(WS_URL)

    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ type: 'log', args: [{ value: 'in-window' }] })
    await client.disconnect()
  })
})
