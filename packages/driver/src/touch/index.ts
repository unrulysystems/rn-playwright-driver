import type { TouchBackendConfig, TouchBackendType } from '../types'
import type { TouchBackend, TouchBackendContext } from './backend'
import { TouchBackendUnavailableError } from './backend'
import { CliTouchBackend } from './cli-backend'
import { InstrumentationTouchBackend } from './instrumentation-backend'
import { NativeModuleTouchBackend } from './native-module-backend'
import { XCTestTouchBackend } from './xctest-backend'

// Per-platform default backend resolution order. Returned as a non-empty tuple so
// the first element is statically known to exist — the `force` path needs a definite
// backend, which a Record index access cannot provide under noUncheckedIndexedAccess.
function defaultOrderForPlatform(
  platform: TouchBackendContext['platform'],
): readonly [TouchBackendType, ...TouchBackendType[]] {
  switch (platform) {
    case 'ios':
      return ['native-module']
    case 'android':
      return ['instrumentation', 'cli']
    default: {
      const _exhaustive: never = platform
      throw new Error(`Unsupported platform: ${String(_exhaustive)}`)
    }
  }
}

export type TouchBackendSelection = {
  backend: TouchBackend
  selection: {
    backend: TouchBackendType
    available: TouchBackendType[]
    reason?: string
  }
  attempted: Array<{ backend: TouchBackendType; error: Error }>
}

export async function createTouchBackend(
  context: TouchBackendContext,
  config: TouchBackendConfig = {},
): Promise<TouchBackendSelection> {
  const mode = config.mode ?? 'auto'
  const attempted: Array<{ backend: TouchBackendType; error: Error }> = []

  const platformDefault = defaultOrderForPlatform(context.platform)
  const order: TouchBackendType[] =
    mode === 'force'
      ? [config.backend ?? platformDefault[0]]
      : (config.order ?? [...platformDefault])

  for (const backendType of order) {
    if (!isBackendSupportedOnPlatform(backendType, context.platform)) {
      continue
    }
    if (!isBackendEnabled(backendType, config)) {
      continue
    }

    const backend = instantiateBackend(backendType, context, config)

    try {
      await backend.init()
      // Compute available backends for diagnostics
      const available = order.filter(
        (b) => isBackendSupportedOnPlatform(b, context.platform) && isBackendEnabled(b, config),
      )
      const selection: TouchBackendSelection['selection'] = {
        backend: backendType,
        available,
      }
      if (attempted.length > 0) {
        selection.reason = `Selected after ${attempted.length} failed attempts`
      }
      return {
        backend,
        selection,
        attempted,
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      attempted.push({ backend: backendType, error: err })
      await backend.dispose().catch(() => undefined)
      if (mode === 'force') {
        throw err
      }
    }
  }

  const attemptSummary = attempted
    .map((attempt) => `${attempt.backend}: ${attempt.error.message}`)
    .join(' | ')
  throw new TouchBackendUnavailableError(
    'native-module',
    attemptSummary.length > 0
      ? `No touch backend available. Attempts: ${attemptSummary}`
      : 'No touch backend available. Install @unrulysystems/rn-driver-touch or configure XCTest/Instrumentation.',
  )
}

function isBackendSupportedOnPlatform(
  backend: TouchBackendType,
  platform: 'ios' | 'android',
): boolean {
  switch (backend) {
    case 'xctest':
      return platform === 'ios'
    case 'instrumentation':
      return platform === 'android'
    case 'cli':
      return platform === 'android'
    case 'native-module':
      return true
    default: {
      const exhaustive: never = backend
      throw new Error(`Unhandled backend: ${exhaustive}`)
    }
  }
}

function isBackendEnabled(backend: TouchBackendType, config: TouchBackendConfig): boolean {
  switch (backend) {
    case 'native-module':
      return config.nativeModule?.enabled ?? true
    case 'cli':
      return config.cli?.enabled ?? true
    case 'xctest':
      return config.xctest?.enabled ?? true
    case 'instrumentation':
      return config.instrumentation?.enabled ?? true
    default:
      return true
  }
}

function instantiateBackend(
  backend: TouchBackendType,
  context: TouchBackendContext,
  config: TouchBackendConfig,
): TouchBackend {
  switch (backend) {
    case 'xctest':
      return new XCTestTouchBackend(config.xctest)
    case 'instrumentation':
      return new InstrumentationTouchBackend(config.instrumentation)
    case 'native-module':
      return new NativeModuleTouchBackend(context)
    case 'cli':
      return new CliTouchBackend(context, config.cli)
    default: {
      const exhaustive: never = backend
      throw new Error(`Unhandled backend: ${exhaustive}`)
    }
  }
}

export type { TouchBackend, TouchBackendContext } from './backend'
export {
  TouchBackendCommandError,
  TouchBackendError,
  TouchBackendNotInitializedError,
  TouchBackendUnavailableError,
} from './backend'
export { CliTouchBackend } from './cli-backend'
export { InstrumentationTouchBackend } from './instrumentation-backend'
export { NativeModuleTouchBackend } from './native-module-backend'
export { XCTestTouchBackend } from './xctest-backend'
