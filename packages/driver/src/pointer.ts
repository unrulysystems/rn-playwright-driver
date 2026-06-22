import type { GestureExecutor } from './gesture-builder'
import { GestureBuilderImpl } from './gesture-builder'
import { DEFAULT_FRAME_MS, resolveInterpolation } from './gesture-utils'
import { MultiGestureBuilderImpl } from './multi-gesture-builder'
import type { TouchBackend } from './touch'
import { TouchBackendNotInitializedError } from './touch'
import type {
  DragOptions,
  DragPathOptions,
  GestureBuilder,
  InterpolationOptions,
  LongPressOptions,
  MoveOptions,
  MovePathOptions,
  MultiGestureBuilder,
  PinchOptions,
  Point,
  PointerEventOptions,
  RotateOptions,
  SwipeOptions,
  TapOptions,
} from './types'

const DEFAULT_DRAG_STEPS = 10
const DEFAULT_SWIPE_DURATION = 300
const DEFAULT_LONG_PRESS_DURATION = 500
const DEFAULT_TAP_DELAY = 100
const DEFAULT_PINCH_STEPS = 10
const DEFAULT_ROTATE_STEPS = 10

/**
 * Interface for device that supports evaluate().
 * Avoids circular dependency with Device type.
 */
interface TimeoutProvider {
  waitForTimeout(ms: number): Promise<void>
}

/**
 * Pointer/touch simulation via TouchBackend.
 *
 * Coordinates are in LOGICAL POINTS (same as RN's coordinate system).
 * Origin (0, 0) is top-left of the screen.
 */
export class Pointer {
  private backend: TouchBackend | null
  private readonly timeoutProvider: TimeoutProvider
  private readonly positions = new Map<number, Point>()

  constructor(backend: TouchBackend | null, timeoutProvider: TimeoutProvider) {
    this.backend = backend
    this.timeoutProvider = timeoutProvider
  }

  setBackend(backend: TouchBackend): void {
    this.backend = backend
  }

  /**
   * Tap at coordinates (down + up).
   */
  async tap(x: number, y: number, options?: TapOptions): Promise<void> {
    const count = Math.max(1, options?.count ?? 1)
    const holdStart = Math.max(0, options?.holdStart ?? DEFAULT_FRAME_MS)
    const tapDelay = Math.max(0, options?.tapDelay ?? DEFAULT_TAP_DELAY)

    for (let i = 0; i < count; i++) {
      await this.sendDown(x, y)
      if (holdStart > 0) {
        await this.timeoutProvider.waitForTimeout(holdStart)
      }
      await this.sendUp()
      if (i < count - 1 && tapDelay > 0) {
        await this.timeoutProvider.waitForTimeout(tapDelay)
      }
    }
  }

  /**
   * Double-tap at coordinates.
   */
  async doubleTap(x: number, y: number, options?: TapOptions): Promise<void> {
    const { count: _ignored, ...rest } = options ?? {}
    await this.tap(x, y, { ...rest, count: 2 })
  }

  /**
   * Long press at coordinates.
   */
  async longPress(x: number, y: number, options?: LongPressOptions): Promise<void> {
    const holdStart = Math.max(0, options?.holdStart ?? DEFAULT_FRAME_MS)
    const holdEnd = Math.max(0, options?.holdEnd ?? DEFAULT_FRAME_MS)
    const duration = Math.max(0, options?.duration ?? DEFAULT_LONG_PRESS_DURATION)

    await this.sendDown(x, y)
    if (holdStart > 0) {
      await this.timeoutProvider.waitForTimeout(holdStart)
    }
    if (duration > 0) {
      await this.timeoutProvider.waitForTimeout(duration)
    }
    if (holdEnd > 0) {
      await this.timeoutProvider.waitForTimeout(holdEnd)
    }
    await this.sendUp()
  }

  /**
   * Press down at coordinates.
   */
  async down(x: number, y: number, options?: PointerEventOptions): Promise<void> {
    await this.sendDown(x, y, options)
  }

  /**
   * Move to coordinates (while pressed).
   */
  async move(x: number, y: number, options?: MoveOptions): Promise<void> {
    const steps = Math.max(1, options?.steps ?? 1)
    const pointerOptions = pickPointerEventOptions(options)
    const pointerId = pointerOptions?.pointerId ?? 0
    const from = this.positions.get(pointerId)

    if (!from || steps === 1) {
      await this.sendMove(x, y, pointerOptions)
      return
    }

    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const nextX = from.x + (x - from.x) * t
      const nextY = from.y + (y - from.y) * t
      await this.sendMove(nextX, nextY, pointerOptions)
    }
  }

  /**
   * Release press.
   */
  async up(options?: PointerEventOptions): Promise<void> {
    await this.sendUp(options)
  }

  /**
   * Drag from one point to another with interpolation.
   */
  async drag(from: Point, to: Point, options?: DragOptions): Promise<void> {
    const holdStart = Math.max(0, options?.holdStart ?? DEFAULT_FRAME_MS)
    const holdEnd = Math.max(0, options?.holdEnd ?? DEFAULT_FRAME_MS)

    await this.sendDown(from.x, from.y)
    if (holdStart > 0) {
      await this.timeoutProvider.waitForTimeout(holdStart)
    }

    await this.performInterpolatedMove(from, to, options, {
      steps: DEFAULT_DRAG_STEPS,
      easing: 'linear',
    })

    if (holdEnd > 0) {
      await this.timeoutProvider.waitForTimeout(holdEnd)
    }
    await this.sendUp()
  }

  /**
   * Swipe from one point to another with duration-based interpolation.
   */
  async swipe(options: SwipeOptions): Promise<void> {
    const holdStart = Math.max(0, options.holdStart ?? DEFAULT_FRAME_MS)
    const holdEnd = Math.max(0, options.holdEnd ?? DEFAULT_FRAME_MS)

    await this.sendDown(options.from.x, options.from.y)
    if (holdStart > 0) {
      await this.timeoutProvider.waitForTimeout(holdStart)
    }

    await this.performInterpolatedMove(options.from, options.to, options, {
      duration: DEFAULT_SWIPE_DURATION,
      steps: DEFAULT_DRAG_STEPS,
      easing: 'ease-out',
    })

    if (holdEnd > 0) {
      await this.timeoutProvider.waitForTimeout(holdEnd)
    }
    await this.sendUp()
  }

  /**
   * Execute a drag gesture along a path of points.
   * Performs down at first point, moves through all points, up at last point.
   *
   * Unlike drag() which interpolates between two points, this follows
   * exact waypoints - useful for complex gestures like bezier curves.
   */
  async dragPath(points: Point[], options?: DragPathOptions): Promise<void> {
    if (points.length === 0) {
      return
    }

    const delay = options?.delay ?? 0
    const holdStart = Math.max(0, options?.holdStart ?? DEFAULT_FRAME_MS)
    const holdEnd = Math.max(0, options?.holdEnd ?? DEFAULT_FRAME_MS)

    await this.sendDown(points[0].x, points[0].y)
    if (holdStart > 0) {
      await this.timeoutProvider.waitForTimeout(holdStart)
    }

    for (let i = 1; i < points.length; i++) {
      await this.sendMove(points[i].x, points[i].y)
      if (delay > 0) {
        await this.timeoutProvider.waitForTimeout(delay)
      }
    }

    if (holdEnd > 0) {
      await this.timeoutProvider.waitForTimeout(holdEnd)
    }
    await this.sendUp()
  }

  /**
   * Move through a path of points without down/up.
   * Useful for hover effects or tracking gestures where the pointer
   * is already down (or doesn't need to be).
   */
  async movePath(points: Point[], options?: MovePathOptions): Promise<void> {
    if (points.length === 0) {
      return
    }

    const delay = options?.delay ?? 0

    for (let i = 0; i < points.length; i++) {
      await this.sendMove(points[i].x, points[i].y)
      if (delay > 0 && i < points.length - 1) {
        await this.timeoutProvider.waitForTimeout(delay)
      }
    }
  }

  /**
   * Create a gesture builder for complex sequences.
   */
  gesture(): GestureBuilder {
    return new GestureBuilderImpl(this.createGestureExecutor())
  }

  /**
   * Multi-touch gesture builder.
   */
  multiGesture(): MultiGestureBuilder {
    return new MultiGestureBuilderImpl(this.createGestureExecutor())
  }

  /**
   * Pinch gesture with two fingers.
   */
  async pinch(options: PinchOptions): Promise<void> {
    const { holdStart, holdEnd, multi } = this.createTwoFingerGesture(
      options.holdStart,
      options.holdEnd,
    )

    const startOffset = options.startDistance / 2
    const endOffset = options.endDistance / 2

    const leftStart = { x: options.center.x - startOffset, y: options.center.y }
    const rightStart = { x: options.center.x + startOffset, y: options.center.y }
    const leftEnd = { x: options.center.x - endOffset, y: options.center.y }
    const rightEnd = { x: options.center.x + endOffset, y: options.center.y }

    const interpolation = this.buildInterpolationOptions(options, DEFAULT_PINCH_STEPS)

    multi
      .pointer(0)
      .down(leftStart.x, leftStart.y)
      .wait(holdStart)
      .moveTo(leftEnd.x, leftEnd.y, interpolation)
      .wait(holdEnd)
      .up()

    multi
      .pointer(1)
      .down(rightStart.x, rightStart.y)
      .wait(holdStart)
      .moveTo(rightEnd.x, rightEnd.y, interpolation)
      .wait(holdEnd)
      .up()

    await multi.execute()
  }

  /**
   * Two-finger rotation gesture.
   */
  async rotate(options: RotateOptions): Promise<void> {
    const { holdStart, holdEnd, multi } = this.createTwoFingerGesture(
      options.holdStart,
      options.holdEnd,
    )

    const startLeft = pointOnCircle(options.center, options.distance, options.startAngle)
    const startRight = pointOnCircle(options.center, options.distance, options.startAngle + Math.PI)
    const endLeft = pointOnCircle(options.center, options.distance, options.endAngle)
    const endRight = pointOnCircle(options.center, options.distance, options.endAngle + Math.PI)

    const interpolation = this.buildInterpolationOptions(options, DEFAULT_ROTATE_STEPS)

    multi
      .pointer(0)
      .down(startLeft.x, startLeft.y)
      .wait(holdStart)
      .moveTo(endLeft.x, endLeft.y, interpolation)
      .wait(holdEnd)
      .up()

    multi
      .pointer(1)
      .down(startRight.x, startRight.y)
      .wait(holdStart)
      .moveTo(endRight.x, endRight.y, interpolation)
      .wait(holdEnd)
      .up()

    await multi.execute()
  }

  private getBackend(): TouchBackend {
    if (!this.backend) {
      throw new TouchBackendNotInitializedError('native-module')
    }
    return this.backend
  }

  private async sendDown(x: number, y: number, options?: PointerEventOptions): Promise<void> {
    await this.sendPointerPosition('down', x, y, options)
  }

  private async sendMove(x: number, y: number, options?: PointerEventOptions): Promise<void> {
    await this.sendPointerPosition('move', x, y, options)
  }

  private async sendUp(options?: PointerEventOptions): Promise<void> {
    if (options) {
      await this.getBackend().up(options)
      return
    }
    await this.getBackend().up()
  }

  private createGestureExecutor(): GestureExecutor {
    return {
      down: async (x, y, options) => this.sendDown(x, y, options),
      move: async (x, y, options) => this.sendMove(x, y, options),
      up: async (options) => this.sendUp(options),
      wait: async (ms) => this.timeoutProvider.waitForTimeout(ms),
    }
  }

  private async performInterpolatedMove(
    from: Point,
    to: Point,
    options: DragOptions | SwipeOptions | undefined,
    defaults: {
      steps: number
      easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
      duration?: number
    },
  ): Promise<void> {
    const { steps, easing, stepDelayMs } = resolveInterpolation(options, defaults)

    for (let i = 1; i <= steps; i++) {
      if (stepDelayMs !== null && stepDelayMs > 0) {
        await this.timeoutProvider.waitForTimeout(stepDelayMs)
      }
      const t = easing(i / steps)
      const x = from.x + (to.x - from.x) * t
      const y = from.y + (to.y - from.y) * t
      await this.sendMove(x, y)
    }
  }

  private async sendPointerPosition(
    type: 'down' | 'move',
    x: number,
    y: number,
    options?: PointerEventOptions,
  ): Promise<void> {
    const pointerId = options?.pointerId ?? 0
    this.positions.set(pointerId, { x, y })
    const backend = this.getBackend()
    if (options) {
      if (type === 'down') {
        await backend.down(x, y, options)
        return
      }
      await backend.move(x, y, options)
      return
    }
    if (type === 'down') {
      await backend.down(x, y)
      return
    }
    await backend.move(x, y)
  }

  private buildInterpolationOptions(
    options:
      | { steps?: number; duration?: number; easing?: InterpolationOptions['easing'] }
      | undefined,
    defaultSteps: number,
  ): InterpolationOptions {
    const interpolation: InterpolationOptions = { steps: options?.steps ?? defaultSteps }
    if (options?.duration !== undefined) {
      interpolation.duration = options.duration
    }
    if (options?.easing !== undefined) {
      interpolation.easing = options.easing
    }
    return interpolation
  }

  private createTwoFingerGesture(
    holdStart: number | undefined,
    holdEnd: number | undefined,
  ): { holdStart: number; holdEnd: number; multi: MultiGestureBuilder } {
    return {
      holdStart: Math.max(0, holdStart ?? DEFAULT_FRAME_MS),
      holdEnd: Math.max(0, holdEnd ?? DEFAULT_FRAME_MS),
      multi: this.multiGesture(),
    }
  }
}

function pickPointerEventOptions(
  options?: PointerEventOptions | MoveOptions,
): PointerEventOptions | undefined {
  if (!options) {
    return undefined
  }
  const { pointerId, pressure } = options
  if (pointerId === undefined && pressure === undefined) {
    return undefined
  }
  const result: PointerEventOptions = {}
  if (pointerId !== undefined) result.pointerId = pointerId
  if (pressure !== undefined) result.pressure = pressure
  return result
}

function pointOnCircle(center: Point, radius: number, angle: number): Point {
  return {
    x: center.x + radius * Math.cos(angle),
    y: center.y + radius * Math.sin(angle),
  }
}
