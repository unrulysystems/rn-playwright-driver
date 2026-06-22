/**
 * Pure fill semantics, shared between the in-app harness (which resolves a real
 * TextInput) and unit tests (which pass a fake). Kept transport-free and
 * side-effect-only-through-the-node so the controlled/uncontrolled behavior is
 * verifiable without a device.
 *
 * Why both setNativeProps AND a change event: for an UNCONTROLLED TextInput the
 * native value is the source of truth, so `setNativeProps({ text })` is enough.
 * For a CONTROLLED TextInput, React state is the source of truth and the next
 * render overwrites setNativeProps — so we must fire the component's change
 * handler (onChangeText / onChange) to update that state. Firing both covers
 * either kind without the caller knowing which it is.
 */

/** Minimal selector shape the in-app resolver matches a TextInput against. */
export interface FillSelector {
  type: string
  value: string
  exact?: boolean
  name?: string
}

/** The minimal surface fill needs from a resolved node. */
export interface FillableNode {
  /** Whether the resolved node is a text input — the resolver decides this. */
  isTextInput: boolean
  /** Controlled-input text handler, when the component declares one. */
  onChangeText?: (text: string) => void
  /** Controlled-input change handler, when the component declares one. */
  onChange?: (event: { nativeEvent: { text: string } }) => void
  /** Imperative native value setter (uncontrolled inputs + immediate mirror). */
  setNativeProps?: (props: { text: string }) => void
}

/** What fill dispatched, for diagnostics + assertions. */
export interface FillDispatch {
  onChangeText: boolean
  onChange: boolean
  setNativeProps: boolean
}

export type FillOutcome =
  | { success: true; dispatched: FillDispatch }
  | { success: false; error: string; code: 'NOT_A_TEXT_INPUT' }

/**
 * Apply `text` to a resolved node: mirror it to the native view and fire the
 * synthetic change so controlled inputs update React state. Errors (does not
 * throw) when the node is not a text input.
 */
export function applyFill(node: FillableNode, text: string): FillOutcome {
  if (!node.isTextInput) {
    return {
      success: false,
      error: 'fill() target is not a text input (no TextInput resolved for this locator)',
      code: 'NOT_A_TEXT_INPUT',
    }
  }

  const dispatched: FillDispatch = {
    onChangeText: false,
    onChange: false,
    setNativeProps: false,
  }

  // Mirror onto the native view first so the value is visible immediately and
  // uncontrolled inputs keep it.
  if (node.setNativeProps) {
    node.setNativeProps({ text })
    dispatched.setNativeProps = true
  }

  // Fire the synthetic change so controlled inputs commit to React state.
  if (node.onChangeText) {
    node.onChangeText(text)
    dispatched.onChangeText = true
  }
  if (node.onChange) {
    node.onChange({ nativeEvent: { text } })
    dispatched.onChange = true
  }

  return { success: true, dispatched }
}
