import type { GestureExecutor } from './gesture-builder'
import { GestureBuilderImpl } from './gesture-builder'
import { dispatchPlannedEvent } from './gesture-dispatch'
import type { GestureBuilder, MultiGestureBuilder, PlannedPointerEvent } from './types'

type ScheduledEvent = {
  time: number
  order: number
  event: PlannedPointerEvent
}

export class MultiGestureBuilderImpl implements MultiGestureBuilder {
  private readonly executor: GestureExecutor
  private readonly builders = new Map<number, GestureBuilderImpl>()

  constructor(executor: GestureExecutor) {
    this.executor = executor
  }

  pointer(id: number): GestureBuilder {
    if (!Number.isInteger(id) || id < 0) {
      throw new Error(`Pointer id must be a non-negative integer. Received: ${id}`)
    }
    const existing = this.builders.get(id)
    if (existing) {
      return existing
    }
    const builder = new GestureBuilderImpl(this.executor, id)
    this.builders.set(id, builder)
    return builder
  }

  async execute(): Promise<void> {
    if (this.builders.size === 0) {
      return
    }

    const scheduled: ScheduledEvent[] = []
    let order = 0

    for (const builder of this.builders.values()) {
      let time = 0
      for (const event of builder.toEvents()) {
        if (event.type === 'wait') {
          time += event.ms ?? 0
          continue
        }
        scheduled.push({ time, order, event })
        order += 1
      }
    }

    scheduled.sort((a, b) => (a.time === b.time ? a.order - b.order : a.time - b.time))

    let currentTime = 0
    for (const item of scheduled) {
      const waitMs = item.time - currentTime
      if (waitMs > 0) {
        await this.executor.wait(waitMs)
        currentTime = item.time
      }
      await this.dispatchEvent(item.event)
    }
  }

  private async dispatchEvent(event: PlannedPointerEvent): Promise<void> {
    await dispatchPlannedEvent(this.executor, event)
  }
}
