import { describe, expect, it } from 'vitest'

import { parseConsoleEvent, parseExceptionEvent } from './runtime-events'

describe('parseConsoleEvent', () => {
  it('flattens primitive args into text and keeps their values', () => {
    const msg = parseConsoleEvent({
      type: 'log',
      args: [
        { type: 'string', value: 'count is' },
        { type: 'number', value: 42 },
      ],
      timestamp: 1234,
    })

    expect(msg).toEqual({
      type: 'log',
      text: 'count is 42',
      args: ['count is', 42],
      timestamp: 1234,
    })
  })

  it('uses description for non-serialized objects, with undefined values', () => {
    const msg = parseConsoleEvent({
      type: 'warning',
      args: [{ type: 'object', description: 'Array(3)' }],
    })

    expect(msg.type).toBe('warning')
    expect(msg.text).toBe('Array(3)')
    expect(msg.args).toEqual([undefined])
  })

  it("defaults type to 'log' and omits timestamp when absent", () => {
    const msg = parseConsoleEvent({ args: [] })

    expect(msg.type).toBe('log')
    expect(msg.text).toBe('')
    expect(msg.args).toEqual([])
    expect('timestamp' in msg).toBe(false)
  })

  it('tolerates a missing args array', () => {
    const msg = parseConsoleEvent({ type: 'error' })

    expect(msg.args).toEqual([])
    expect(msg.text).toBe('')
  })
})

describe('parseExceptionEvent', () => {
  it('reads message and stack from the exception description', () => {
    const err = parseExceptionEvent({
      timestamp: 99,
      exceptionDetails: {
        text: 'Uncaught',
        exception: { description: 'TypeError: x is not a function\n    at App.tsx:10' },
      },
    })

    expect(err).toEqual({
      message: 'TypeError: x is not a function\n    at App.tsx:10',
      stack: 'TypeError: x is not a function\n    at App.tsx:10',
      timestamp: 99,
    })
  })

  it('falls back to exceptionDetails.text when no exception object is attached', () => {
    const err = parseExceptionEvent({
      exceptionDetails: { text: 'Uncaught SyntaxError' },
    })

    expect(err.message).toBe('Uncaught SyntaxError')
    expect('stack' in err).toBe(false)
    expect('timestamp' in err).toBe(false)
  })

  it('falls back to a generic message when nothing usable is present', () => {
    const err = parseExceptionEvent({})

    expect(err.message).toBe('Uncaught exception')
  })
})
