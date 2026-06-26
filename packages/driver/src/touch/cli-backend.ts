import { execFile, type ExecFileException } from 'node:child_process'
import type {
  LongPressOptions,
  Point,
  PointerEventOptions,
  TapOptions,
  TouchBackendConfig,
} from '../types'
import type { TouchBackend, TouchBackendContext } from './backend'
import { TouchBackendCommandError, TouchBackendUnavailableError } from './backend'
import { resolveLongPressDuration } from './backend-options'

export type AdbExec = (args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>

type CliTouchBackendDeps = {
  exec?: AdbExec
}

type PxPoint = {
  x: number
  y: number
}

const DEFAULT_ADB_PATH = 'adb'
const DEFAULT_ADB_COMMAND_TIMEOUT_MS = 10_000
const WINDOW_METRICS_EXPRESSION = 'globalThis.__RN_DRIVER__.getWindowMetrics()'
const SDK_PROPERTY = 'ro.build.version.sdk'
const MOTION_EVENT_MIN_API = 30

export class CliTouchBackend implements TouchBackend {
  readonly name = 'cli' as const
  private readonly context: TouchBackendContext
  private readonly adbPath: string
  private readonly serial: string | undefined
  private readonly exec: AdbExec
  private density?: number
  private sdkLevel?: number
  private lastPoint: PxPoint | undefined
  private isTouchActive = false

  constructor(
    context: TouchBackendContext,
    config?: TouchBackendConfig['cli'],
    deps: CliTouchBackendDeps = {},
  ) {
    this.context = context
    this.adbPath = config?.adbPath ?? DEFAULT_ADB_PATH
    this.serial = config?.serial
    this.exec = deps.exec ?? createDefaultAdbExec(this.adbPath)
  }

  async init(): Promise<void> {
    const args = this.adbArgs(['get-state'])
    let result: Awaited<ReturnType<AdbExec>>
    try {
      result = await this.exec(args)
    } catch (error) {
      throw new TouchBackendUnavailableError(
        this.name,
        `adb get-state failed for ${this.describeTarget()}: ${errorMessage(error)}`,
      )
    }

    const state = result.stdout.trim()
    if (result.code !== 0 || state !== 'device') {
      const detail = result.stderr.trim() || state || `adb exited with code ${String(result.code)}`
      throw new TouchBackendUnavailableError(
        this.name,
        `adb get-state failed for ${this.describeTarget()}: expected "device", got ${JSON.stringify(detail)}`,
      )
    }
  }

  async dispose(): Promise<void> {
    return
  }

  async tap(x: number, y: number, _options?: TapOptions): Promise<void> {
    const point = await this.toPxPoint({ x, y })
    await this.runCommand(['shell', 'input', 'tap', String(point.x), String(point.y)])
  }

  async down(x: number, y: number, _options?: PointerEventOptions): Promise<void> {
    await this.ensureMotionEventSupported()
    const point = await this.toPxPoint({ x, y })
    await this.runMotionEvent('DOWN', point)
    this.lastPoint = point
    this.isTouchActive = true
  }

  async move(x: number, y: number, _options?: PointerEventOptions): Promise<void> {
    await this.ensureMotionEventSupported()
    if (!this.isTouchActive) {
      throw new TouchBackendCommandError(
        this.name,
        'Cannot emit adb motionevent MOVE before a down command starts a touch sequence.',
        'NO_ACTIVE_TOUCH',
      )
    }
    const point = await this.toPxPoint({ x, y })
    await this.runMotionEvent('MOVE', point)
    this.lastPoint = point
  }

  async up(_options?: PointerEventOptions): Promise<void> {
    await this.ensureMotionEventSupported()
    if (!this.isTouchActive || this.lastPoint === undefined) {
      throw new TouchBackendCommandError(
        this.name,
        'Cannot emit adb motionevent UP before a down command starts a touch sequence.',
        'NO_ACTIVE_TOUCH',
      )
    }
    await this.runMotionEvent('UP', this.lastPoint)
    this.isTouchActive = false
    this.lastPoint = undefined
  }

  async swipe(from: Point, to: Point, durationMs: number): Promise<void> {
    const fromPx = await this.toPxPoint(from)
    const toPx = await this.toPxPoint(to)
    await this.runCommand([
      'shell',
      'input',
      'swipe',
      String(fromPx.x),
      String(fromPx.y),
      String(toPx.x),
      String(toPx.y),
      String(durationMs),
    ])
  }

  async longPress(x: number, y: number, options: LongPressOptions): Promise<void> {
    const point = await this.toPxPoint({ x, y })
    const durationMs = resolveLongPressDuration(options)
    await this.runCommand([
      'shell',
      'input',
      'swipe',
      String(point.x),
      String(point.y),
      String(point.x),
      String(point.y),
      String(durationMs),
    ])
  }

  async typeText(text: string): Promise<void> {
    await this.runCommand(['shell', 'input', 'text', escapeAdbInputText(text)])
  }

  private adbArgs(args: string[]): string[] {
    if (this.serial === undefined) {
      return args
    }
    return ['-s', this.serial, ...args]
  }

  private describeTarget(): string {
    return this.serial === undefined
      ? `adb path "${this.adbPath}"`
      : `adb path "${this.adbPath}" and serial "${this.serial}"`
  }

  private async densityValue(): Promise<number> {
    if (this.density !== undefined) {
      return this.density
    }

    const metrics = await this.context.evaluate<{ pixelRatio?: unknown }>(WINDOW_METRICS_EXPRESSION)
    const density = metrics.pixelRatio
    if (typeof density !== 'number' || !Number.isFinite(density) || density <= 0) {
      throw new TouchBackendCommandError(
        this.name,
        `Invalid React Native PixelRatio density for adb touch conversion: ${String(density)}`,
      )
    }
    this.density = density
    return density
  }

  private async toPxPoint(point: Point): Promise<PxPoint> {
    const density = await this.densityValue()
    return {
      x: Math.round(point.x * density),
      y: Math.round(point.y * density),
    }
  }

  private async sdkLevelValue(): Promise<number> {
    if (this.sdkLevel !== undefined) {
      return this.sdkLevel
    }

    const result = await this.runCommand(['shell', 'getprop', SDK_PROPERTY])
    const sdkLevel = Number.parseInt(result.stdout.trim(), 10)
    if (!Number.isFinite(sdkLevel)) {
      throw new TouchBackendCommandError(
        this.name,
        `Unable to parse Android SDK level from adb getprop ${SDK_PROPERTY}: ${JSON.stringify(result.stdout.trim())}`,
      )
    }
    this.sdkLevel = sdkLevel
    return sdkLevel
  }

  private async ensureMotionEventSupported(): Promise<void> {
    const sdkLevel = await this.sdkLevelValue()
    if (sdkLevel < MOTION_EVENT_MIN_API) {
      throw new TouchBackendCommandError(
        this.name,
        `adb shell input motionevent requires API ${String(MOTION_EVENT_MIN_API)} or newer; use the instrumentation companion for streaming gestures on API < ${String(MOTION_EVENT_MIN_API)}.`,
        'NOT_SUPPORTED',
      )
    }
  }

  private async runMotionEvent(event: 'DOWN' | 'MOVE' | 'UP', point: PxPoint): Promise<void> {
    await this.runCommand([
      'shell',
      'input',
      'motionevent',
      event,
      String(point.x),
      String(point.y),
    ])
  }

  private async runCommand(
    args: string[],
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    const adbArgs = this.adbArgs(args)
    let result: Awaited<ReturnType<AdbExec>>
    try {
      result = await this.exec(adbArgs)
    } catch (error) {
      throw new TouchBackendCommandError(this.name, errorMessage(error))
    }

    if (result.code !== 0) {
      throw new TouchBackendCommandError(
        this.name,
        result.stderr.trim() || `adb command failed with exit code ${String(result.code)}`,
      )
    }
    return result
  }
}

function createDefaultAdbExec(adbPath: string): AdbExec {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(
        adbPath,
        args,
        { timeout: DEFAULT_ADB_COMMAND_TIMEOUT_MS, killSignal: 'SIGKILL' },
        (error: ExecFileException | null, stdout, stderr) => {
          if (error === null) {
            resolve({ stdout, stderr, code: 0 })
            return
          }

          if (typeof error.code === 'number') {
            resolve({ stdout, stderr, code: error.code })
            return
          }

          reject(error)
        },
      )
    })
}

function escapeAdbInputText(text: string): string {
  if (text.includes('\0') || text.includes('\r') || text.includes('\n')) {
    throw new TouchBackendCommandError(
      'cli',
      'adb shell input text does not support NUL or newline characters.',
      'UNSUPPORTED_TEXT',
    )
  }
  // Android's `input text` is ASCII-oriented: spaces are `%s`, and characters
  // that the device shell would interpret must be escaped before input receives them.
  return text.replace(/[$ "`'()&<>;|\\]/g, (character) => {
    if (character === ' ') {
      return '%s'
    }
    return `\\${character}`
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
