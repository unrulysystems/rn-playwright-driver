/**
 * Pure fill semantics + fiber resolution helpers, co-located WITH the harness so
 * they ship as `.ts` source in the published package (Metro bundles them in-app).
 * They previously lived in `src/fill.ts`, which is NOT in `package.json#files` —
 * the harness's value import of `applyFill` then failed to resolve for consumers
 * installing the package. Keep this module here, not under `src/`.
 *
 * Everything here is transport-free and free of React-DevTools-hook access (that
 * lives in `harness/index.ts`), so the controlled/uncontrolled behavior AND the
 * fiber-matching predicate are verifiable in unit tests without a device.
 *
 * Why applyFill fires setNativeProps AND a change event: for an UNCONTROLLED
 * TextInput the native value is the source of truth, so `setNativeProps({ text })`
 * is enough. For a CONTROLLED TextInput, React state is the source of truth and
 * the next render overwrites setNativeProps — so we must fire the component's
 * change handler (onChangeText / onChange) to update that state. Firing both
 * covers either kind without the caller knowing which it is.
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

// --- Fiber resolution (pure; the DevTools-hook access lives in harness/index.ts) ---

/** A React fiber's component identity slot — a host string, a component, or absent. */
type FiberType = { displayName?: string; name?: string } | string | null

/** The slice of a React fiber we traverse — all optional, so we fail closed. */
export type FiberNode = {
  /** Resolved component for this fiber (function/class/host); preferred identity. */
  type?: FiberType
  /** Original element type before resolution (e.g. memo/forwardRef wrappers). */
  elementType?: FiberType
  memoizedProps?: Record<string, unknown> | null
  stateNode?: { setNativeProps?: (props: { text: string }) => void } | null
  child?: FiberNode | null
  sibling?: FiberNode | null
}

/** Best-effort display name for a fiber's component identity. */
function fiberComponentName(fiber: FiberNode): string | undefined {
  const identity = fiber.elementType ?? fiber.type
  if (typeof identity === 'string') {
    return identity
  }
  return identity?.displayName ?? identity?.name
}

/**
 * Identify a TextInput by its React COMPONENT IDENTITY, not by the presence of an
 * `onChangeText` prop. An UNCONTROLLED TextInput declares no onChangeText yet is
 * still fillable via setNativeProps, so gating on the prop (the prior bug)
 * rejected valid targets. RN's TextInput composite resolves to displayName
 * 'TextInput'.
 */
export function isTextInputFiber(fiber: FiberNode): boolean {
  return fiberComponentName(fiber) === 'TextInput'
}

/** Iterative DFS over child/sibling links for a TextInput fiber with `testId`. */
export function findFiberByTestId(root: FiberNode | null, testId: string): FiberNode | null {
  const stack: FiberNode[] = root ? [root] : []
  while (stack.length > 0) {
    const fiber = stack.pop()
    if (!fiber) {
      continue
    }
    const props = fiber.memoizedProps
    if (props && props.testID === testId && isTextInputFiber(fiber)) {
      return fiber
    }
    // Push sibling first so pop() visits the child subtree first — natural
    // document order, which disambiguates if a testID somehow appears twice.
    if (fiber.sibling) {
      stack.push(fiber.sibling)
    }
    if (fiber.child) {
      stack.push(fiber.child)
    }
  }
  return null
}

/** Build the fill surface from a matched TextInput fiber. */
export function fiberToFillable(fiber: FiberNode): FillableNode {
  const props = fiber.memoizedProps ?? {}
  const onChangeText = props.onChangeText
  const onChange = props.onChange
  const setNativeProps = fiber.stateNode?.setNativeProps
  return {
    isTextInput: true,
    ...(typeof onChangeText === 'function'
      ? { onChangeText: onChangeText as (text: string) => void }
      : {}),
    ...(typeof onChange === 'function'
      ? { onChange: onChange as (event: { nativeEvent: { text: string } }) => void }
      : {}),
    ...(typeof setNativeProps === 'function'
      ? { setNativeProps: setNativeProps.bind(fiber.stateNode) }
      : {}),
  }
}
