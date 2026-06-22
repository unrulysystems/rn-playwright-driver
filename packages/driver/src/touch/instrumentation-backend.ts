import type { LongPressOptions, Point, PointerEventOptions, TapOptions } from '../types'
import type { TouchBackend } from './backend'
import { TouchBackendCommandError, TouchBackendUnavailableError } from './backend'
import {
  resolveLongPressDuration,
  resolveTouchBackendOptions,
  type TouchBackendOptions,
} from './backend-options'

export type InstrumentationBackendOptions = TouchBackendOptions

export class InstrumentationTouchBackend implements TouchBackend {
  readonly name = 'instrumentation' as const
  private readonly baseUrl: string
  private readonly connectTimeoutMs: number
  private readonly requestTimeoutMs: number

  constructor(options: InstrumentationBackendOptions = {}) {
    const resolved = resolveTouchBackendOptions(options, (host, port) => `http://${host}:${port}`)
    this.baseUrl = resolved.url
    this.connectTimeoutMs = resolved.connectTimeoutMs
    this.requestTimeoutMs = resolved.requestTimeoutMs
  }

  async init(): Promise<void> {
    await this.sendCommand({ type: 'hello' }, this.connectTimeoutMs)
  }

  async dispose(): Promise<void> {
    return
  }

  async tap(x: number, y: number, _options?: TapOptions): Promise<void> {
    await this.sendCommand({ type: 'tap', x, y })
  }

  async down(x: number, y: number, _options?: PointerEventOptions): Promise<void> {
    await this.sendCommand({ type: 'down', x, y })
  }

  async move(x: number, y: number, _options?: PointerEventOptions): Promise<void> {
    await this.sendCommand({ type: 'move', x, y })
  }

  async up(_options?: PointerEventOptions): Promise<void> {
    await this.sendCommand({ type: 'up' })
  }

  async swipe(from: Point, to: Point, durationMs: number): Promise<void> {
    await this.sendCommand({ type: 'swipe', from, to, durationMs })
  }

  async longPress(x: number, y: number, options: LongPressOptions): Promise<void> {
    const durationMs = resolveLongPressDuration(options)
    await this.sendCommand({ type: 'longPress', x, y, durationMs })
  }

  async typeText(text: string): Promise<void> {
    await this.sendCommand({ type: 'typeText', text })
  }

  private async sendCommand(
    payload: Record<string, unknown>,
    timeoutOverride?: number,
  ): Promise<void> {
    const controller = new AbortController()
    const timeoutMs = timeoutOverride ?? this.requestTimeoutMs
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(`${this.baseUrl}/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new TouchBackendUnavailableError(
          this.name,
          `HTTP ${response.status} from instrumentation companion`,
        )
      }

      const data = (await response.json()) as {
        ok?: boolean
        error?: { message?: string; code?: string }
      }

      if (!data.ok) {
        const message = data.error?.message ?? 'Instrumentation command failed'
        const code = data.error?.code
        throw new TouchBackendCommandError(this.name, message, code)
      }
    } catch (error) {
      if (error instanceof TouchBackendCommandError) {
        throw error
      }
      if (error instanceof TouchBackendUnavailableError) {
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new TouchBackendUnavailableError(this.name, message)
    } finally {
      clearTimeout(timeoutId)
    }
  }
}
