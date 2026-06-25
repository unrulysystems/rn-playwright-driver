import type {
  LongPressOptions,
  Point,
  PointerEventOptions,
  TapOptions,
  TouchBackendConfig,
} from '../types'
import type { TouchBackend, TouchBackendContext } from './backend'
import { TouchBackendUnavailableError } from './backend'

export class CliTouchBackend implements TouchBackend {
  readonly name = 'cli' as const
  private readonly context: TouchBackendContext
  private readonly config?: TouchBackendConfig['cli']

  constructor(context: TouchBackendContext, config?: TouchBackendConfig['cli']) {
    this.context = context
    this.config = config
  }

  async init(): Promise<void> {
    void this.context
    void this.config
    throw new TouchBackendUnavailableError(
      this.name,
      'CLI touch backend not implemented yet. Install @unrulysystems/rn-driver-touch or configure XCTest/Instrumentation.',
    )
  }

  async dispose(): Promise<void> {
    return
  }

  async tap(_x: number, _y: number, _options?: TapOptions): Promise<void> {
    throw new TouchBackendUnavailableError(this.name, 'CLI touch backend not available.')
  }

  async down(_x: number, _y: number, _options?: PointerEventOptions): Promise<void> {
    throw new TouchBackendUnavailableError(this.name, 'CLI touch backend not available.')
  }

  async move(_x: number, _y: number, _options?: PointerEventOptions): Promise<void> {
    throw new TouchBackendUnavailableError(this.name, 'CLI touch backend not available.')
  }

  async up(_options?: PointerEventOptions): Promise<void> {
    throw new TouchBackendUnavailableError(this.name, 'CLI touch backend not available.')
  }

  async swipe(_from: Point, _to: Point, _durationMs: number): Promise<void> {
    throw new TouchBackendUnavailableError(this.name, 'CLI touch backend not available.')
  }

  async longPress(_x: number, _y: number, _options: LongPressOptions): Promise<void> {
    throw new TouchBackendUnavailableError(this.name, 'CLI touch backend not available.')
  }

  async typeText(_text: string): Promise<void> {
    throw new TouchBackendUnavailableError(this.name, 'CLI touch backend not available.')
  }
}
