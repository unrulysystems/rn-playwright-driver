import type { ConsoleMessage, PageError } from '../types'

/**
 * Pure parsers that turn raw CDP `Runtime.*` event payloads into the driver's
 * public event shapes. Kept side-effect-free so they can be unit-tested without
 * a transport, and so the event-forwarding wiring stays trivial.
 */

/** The subset of a CDP RemoteObject this driver reads. */
type RemoteObject = {
  type?: string
  value?: unknown
  description?: string
}

function asRemoteObject(arg: unknown): RemoteObject {
  return arg !== null && typeof arg === 'object' ? (arg as RemoteObject) : {}
}

/** By-value payload of a console argument, when the runtime serialized one. */
function remoteObjectValue(arg: unknown): unknown {
  const ro = asRemoteObject(arg)
  return 'value' in ro ? ro.value : undefined
}

/** Best-effort human-readable rendering of a single console argument. */
function remoteObjectText(arg: unknown): string {
  const ro = asRemoteObject(arg)
  // Primitives come across with a `value`; objects/functions only carry a
  // `description` (e.g. "Array(3)") since they aren't serialized by value.
  if ('value' in ro && ro.value !== undefined) {
    return String(ro.value)
  }
  return typeof ro.description === 'string' ? ro.description : ''
}

/**
 * Parse a `Runtime.consoleAPICalled` payload into a {@link ConsoleMessage}.
 */
export function parseConsoleEvent(params: Record<string, unknown>): ConsoleMessage {
  const type = typeof params.type === 'string' ? params.type : 'log'
  const rawArgs = Array.isArray(params.args) ? params.args : []
  return {
    type,
    text: rawArgs.map(remoteObjectText).join(' '),
    args: rawArgs.map(remoteObjectValue),
    ...(typeof params.timestamp === 'number' ? { timestamp: params.timestamp } : {}),
  }
}

/**
 * Parse a `Runtime.exceptionThrown` payload into a {@link PageError}.
 */
export function parseExceptionEvent(params: Record<string, unknown>): PageError {
  const details =
    params.exceptionDetails !== null && typeof params.exceptionDetails === 'object'
      ? (params.exceptionDetails as {
          text?: string
          exception?: { description?: string }
        })
      : {}
  const description =
    details.exception !== null && typeof details.exception === 'object'
      ? details.exception.description
      : undefined

  // Hermes/V8 put the full "Error: msg\n  at ..." string in the exception
  // description; the bare `text` ("Uncaught") is the fallback when no exception
  // object is attached. The description doubles as the stack since it carries the
  // trace.
  const message = description ?? details.text ?? 'Uncaught exception'
  return {
    message,
    ...(typeof description === 'string' ? { stack: description } : {}),
    ...(typeof params.timestamp === 'number' ? { timestamp: params.timestamp } : {}),
  }
}
