import type { GestureExecutor } from './gesture-builder'
import type { PlannedPointerEvent, PointerEventOptions } from './types'

export async function dispatchPlannedEvent(
  executor: GestureExecutor,
  event: PlannedPointerEvent,
): Promise<void> {
  switch (event.type) {
    case 'down':
      if (event.x === undefined || event.y === undefined) {
        throw new Error('Planned down event is missing coordinates.')
      }
      await executor.down(event.x, event.y, buildPointerOptions(event.pointerId, event.pressure))
      return
    case 'move':
      if (event.x === undefined || event.y === undefined) {
        throw new Error('Planned move event is missing coordinates.')
      }
      await executor.move(event.x, event.y, buildPointerOptions(event.pointerId, undefined))
      return
    case 'up':
      await executor.up(buildPointerOptions(event.pointerId, event.pressure))
      return
    case 'wait':
      if (event.ms === undefined) {
        throw new Error('Planned wait event is missing duration.')
      }
      await executor.wait(event.ms)
      return
    default: {
      const exhaustive: never = event.type
      throw new Error(`Unhandled planned event: ${exhaustive}`)
    }
  }
}

function buildPointerOptions(
  pointerId?: number,
  pressure?: number,
): PointerEventOptions | undefined {
  if (pointerId === undefined && pressure === undefined) {
    return undefined
  }
  const options: PointerEventOptions = {}
  if (pointerId !== undefined) {
    options.pointerId = pointerId
  }
  if (pressure !== undefined) {
    options.pressure = pressure
  }
  return options
}
