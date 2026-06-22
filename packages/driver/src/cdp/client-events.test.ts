/**
 * Tests for CDPClient's CDP-event dispatch: messages carrying `method` (and no
 * matching request `id`) must be routed to onEvent subscribers. handleMessage is
 * private; drive it directly through a narrowly-typed internals handle so the
 * test exercises the real parse + dispatch path without a websocket.
 */
import { describe, expect, it, vi } from 'vitest'

import { CDPClient } from './client'

type ClientInternals = {
  handleMessage: (data: Buffer) => void
}

const internals = (client: CDPClient): ClientInternals => client as unknown as ClientInternals

function deliver(client: CDPClient, message: object): void {
  internals(client).handleMessage(Buffer.from(JSON.stringify(message)))
}

describe('CDPClient event dispatch', () => {
  it('routes a method event to its subscriber with params', () => {
    const client = new CDPClient()
    const handler = vi.fn()
    client.onEvent('Runtime.consoleAPICalled', handler)

    deliver(client, {
      method: 'Runtime.consoleAPICalled',
      params: { type: 'log', args: [{ value: 'hi' }] },
    })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ type: 'log', args: [{ value: 'hi' }] })
  })

  it('passes an empty object when an event carries no params', () => {
    const client = new CDPClient()
    const handler = vi.fn()
    client.onEvent('Runtime.exceptionThrown', handler)

    deliver(client, { method: 'Runtime.exceptionThrown' })

    expect(handler).toHaveBeenCalledWith({})
  })

  it('stops delivering after unsubscribe', () => {
    const client = new CDPClient()
    const handler = vi.fn()
    const unsubscribe = client.onEvent('Runtime.consoleAPICalled', handler)

    unsubscribe()
    deliver(client, { method: 'Runtime.consoleAPICalled', params: {} })

    expect(handler).not.toHaveBeenCalled()
  })

  it('isolates a throwing handler from the others', () => {
    const client = new CDPClient()
    const thrower = vi.fn(() => {
      throw new Error('boom')
    })
    const ok = vi.fn()
    client.onEvent('Runtime.consoleAPICalled', thrower)
    client.onEvent('Runtime.consoleAPICalled', ok)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    deliver(client, { method: 'Runtime.consoleAPICalled', params: {} })

    expect(thrower).toHaveBeenCalledTimes(1)
    expect(ok).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })

  it('does not treat a request response (matching id) as an event', () => {
    const client = new CDPClient()
    const handler = vi.fn()
    client.onEvent('Runtime.evaluate', handler)

    // A response has an id but no pending request here, and no method — nothing fires.
    deliver(client, { id: 7, result: { value: 1 } })

    expect(handler).not.toHaveBeenCalled()
  })
})
