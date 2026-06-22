import { dispatchPlannedEvent } from './gesture-dispatch'
import { DEFAULT_FRAME_MS, resolveInterpolation } from './gesture-utils'
import type {
  GestureBuilder,
  InterpolationOptions,
  PlannedPointerEvent,
  Point,
  PointerEventOptions,
} from './types'

export type GestureExecutor = {
  down: (x: number, y: number, options?: PointerEventOptions) => Promise<void>
  move: (x: number, y: number, options?: PointerEventOptions) => Promise<void>
  up: (options?: PointerEventOptions) => Promise<void>
  wait: (ms: number) => Promise<void>
}

export class GestureBuilderImpl implements GestureBuilder {
  private readonly executor: GestureExecutor
  private readonly pointerId: number | undefined
  private readonly events: PlannedPointerEvent[] = []
  private currentPosition: Point | null = null

  constructor(executor: GestureExecutor, pointerId?: number) {
    this.executor = executor
    this.pointerId = pointerId
  }

  down(x: number, y: number, options?: PointerEventOptions): this {
    const pointerId = this.resolvePointerId(options)
    this.events.push({
      type: 'down',
      x,
      y,
      ...buildPlannedPointerFields(pointerId, options?.pressure),
    })
    this.currentPosition = { x, y }
    return this
  }

  up(options?: PointerEventOptions): this {
    const pointerId = this.resolvePointerId(options)
    this.events.push({ type: 'up', ...buildPlannedPointerFields(pointerId, options?.pressure) })
    return this
  }

  moveTo(x: number, y: number, options?: InterpolationOptions): this {
    if (!this.currentPosition) {
      this.currentPosition = { x, y }
      this.events.push({
        type: 'move',
        x,
        y,
        ...buildPlannedPointerFields(this.pointerId, undefined),
      })
      return this
    }

    const from = this.currentPosition
    this.pushInterpolatedMoves(options, { steps: 1, easing: 'linear' }, (t) => ({
      x: from.x + (x - from.x) * t,
      y: from.y + (y - from.y) * t,
    }))
    this.currentPosition = { x, y }
    return this
  }

  moveBy(dx: number, dy: number, options?: InterpolationOptions): this {
    if (!this.currentPosition) {
      throw new Error('moveBy() requires a starting position. Call down() or moveTo() first.')
    }
    const target = { x: this.currentPosition.x + dx, y: this.currentPosition.y + dy }
    return this.moveTo(target.x, target.y, options)
  }

  wait(ms: number): this {
    const delay = Math.max(0, ms)
    if (delay > 0) {
      this.events.push({ type: 'wait', ms: delay })
    }
    return this
  }

  waitFrames(count: number): this {
    const frames = Math.max(0, count)
    if (frames > 0) {
      this.events.push({ type: 'wait', ms: frames * DEFAULT_FRAME_MS })
    }
    return this
  }

  arc(
    center: Point,
    radius: number,
    startAngle: number,
    endAngle: number,
    options?: InterpolationOptions,
  ): this {
    this.pushInterpolatedMoves(options, { steps: 1, easing: 'linear' }, (t) => {
      const angle = startAngle + (endAngle - startAngle) * t
      return {
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle),
      }
    })
    const endPoint = {
      x: center.x + radius * Math.cos(endAngle),
      y: center.y + radius * Math.sin(endAngle),
    }
    this.currentPosition = endPoint
    return this
  }

  bezier(control1: Point, control2: Point, end: Point, options?: InterpolationOptions): this {
    if (!this.currentPosition) {
      throw new Error('bezier() requires a starting position. Call down() or moveTo() first.')
    }
    const start = this.currentPosition
    this.pushInterpolatedMoves(options, { steps: 1, easing: 'linear' }, (t) => {
      const oneMinusT = 1 - t
      const x =
        oneMinusT * oneMinusT * oneMinusT * start.x +
        3 * oneMinusT * oneMinusT * t * control1.x +
        3 * oneMinusT * t * t * control2.x +
        t * t * t * end.x
      const y =
        oneMinusT * oneMinusT * oneMinusT * start.y +
        3 * oneMinusT * oneMinusT * t * control1.y +
        3 * oneMinusT * t * t * control2.y +
        t * t * t * end.y
      return { x, y }
    })
    this.currentPosition = end
    return this
  }

  async execute(): Promise<void> {
    for (const event of this.events) {
      await this.dispatchEvent(event)
    }
  }

  toEvents(): PlannedPointerEvent[] {
    return [...this.events]
  }

  private async dispatchEvent(event: PlannedPointerEvent): Promise<void> {
    await dispatchPlannedEvent(this.executor, event)
  }

  private pushInterpolatedMoves(
    options: InterpolationOptions | undefined,
    defaults: {
      steps: number
      easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
      duration?: number
    },
    pointAt: (t: number) => Point,
  ): void {
    const { steps, easing, stepDelayMs } = resolveInterpolation(options, defaults)
    for (let i = 1; i <= steps; i++) {
      if (stepDelayMs !== null && stepDelayMs > 0) {
        this.events.push({ type: 'wait', ms: stepDelayMs })
      }
      const point = pointAt(easing(i / steps))
      this.events.push({
        type: 'move',
        x: point.x,
        y: point.y,
        ...buildPlannedPointerFields(this.pointerId, undefined),
      })
    }
  }

  private resolvePointerId(options?: PointerEventOptions): number | undefined {
    if (this.pointerId === undefined) {
      return options?.pointerId
    }
    if (options?.pointerId !== undefined && options.pointerId !== this.pointerId) {
      throw new Error(
        `Pointer ID mismatch. Builder is locked to ${this.pointerId} but got ${options.pointerId}.`,
      )
    }
    return this.pointerId
  }
}

function buildPlannedPointerFields(
  pointerId?: number,
  pressure?: number,
): { pointerId?: number; pressure?: number } {
  const fields: { pointerId?: number; pressure?: number } = {}
  if (pointerId !== undefined) {
    fields.pointerId = pointerId
  }
  if (pressure !== undefined) {
    fields.pressure = pressure
  }
  return fields
}
