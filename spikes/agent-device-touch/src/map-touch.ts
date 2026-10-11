import type {
  AgentDeviceClient,
  LongPressOptions,
  PressOptions,
  SwipeOptions,
  TypeTextOptions,
} from 'agent-device'

/**
 * The published client methods that accept a coordinate and complete one gesture.
 * `down` / `move` / `up` are absent; see {@link streamingPointerMethodsAreAbsent}.
 */
export type CoordinateInteractions = Pick<
  AgentDeviceClient['interactions'],
  'press' | 'longPress' | 'swipe' | 'type'
>

type Missing<Surface, Key extends string> = Key extends keyof Surface ? never : true

/**
 * Witness that the published interactions surface has no streaming pointer methods.
 * Adding `down`, `move`, or `up` makes this assignment fail to typecheck.
 */
export type StreamingPointerGap = [
  Missing<AgentDeviceClient['interactions'], 'down'>,
  Missing<AgentDeviceClient['interactions'], 'move'>,
  Missing<AgentDeviceClient['interactions'], 'up'>,
]

export const streamingPointerMethodsAreAbsent: StreamingPointerGap = [true, true, true]

export async function tapAt(
  interactions: CoordinateInteractions,
  x: number,
  y: number,
): Promise<void> {
  const press: PressOptions = { x, y }
  await interactions.press(press)
}

export async function longPressAt(
  interactions: CoordinateInteractions,
  x: number,
  y: number,
  durationMs: number,
): Promise<void> {
  const press: LongPressOptions = { x, y, durationMs }
  await interactions.longPress(press)
}

export async function swipeBetween(
  interactions: CoordinateInteractions,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
): Promise<void> {
  const swipe: SwipeOptions = { from, to }
  await interactions.swipe(swipe)
}

export async function typeFocusedText(
  interactions: CoordinateInteractions,
  text: string,
): Promise<void> {
  const command: TypeTextOptions = { text }
  await interactions.type(command)
}
