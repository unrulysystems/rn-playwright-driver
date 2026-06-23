import { describe, expect, it, vi } from 'vitest'

import {
  applyFill,
  type FiberNode,
  type FillableNode,
  fiberToFillable,
  findFiberByTestId,
  isTextInputFiber,
} from './fill'

describe('applyFill', () => {
  it('fires onChangeText for a controlled input and mirrors via setNativeProps', () => {
    const onChangeText = vi.fn()
    const setNativeProps = vi.fn()
    const node: FillableNode = { isTextInput: true, onChangeText, setNativeProps }

    const outcome = applyFill(node, 'hello')

    expect(outcome.success).toBe(true)
    expect(onChangeText).toHaveBeenCalledWith('hello')
    expect(setNativeProps).toHaveBeenCalledWith({ text: 'hello' })
    if (outcome.success) {
      expect(outcome.dispatched).toEqual({
        onChangeText: true,
        onChange: false,
        setNativeProps: true,
      })
    }
  })

  it('fires the onChange handler with a synthetic nativeEvent', () => {
    const onChange = vi.fn()
    const node: FillableNode = { isTextInput: true, onChange }

    const outcome = applyFill(node, 'world')

    expect(onChange).toHaveBeenCalledWith({ nativeEvent: { text: 'world' } })
    expect(outcome.success && outcome.dispatched.onChange).toBe(true)
  })

  it('sets native props only for an uncontrolled input (no change handlers)', () => {
    const setNativeProps = vi.fn()
    const node: FillableNode = { isTextInput: true, setNativeProps }

    const outcome = applyFill(node, 'abc')

    expect(setNativeProps).toHaveBeenCalledWith({ text: 'abc' })
    expect(outcome.success && outcome.dispatched).toEqual({
      onChangeText: false,
      onChange: false,
      setNativeProps: true,
    })
  })

  it('errors with NOT_A_TEXT_INPUT when the node is not a text input', () => {
    const onChangeText = vi.fn()
    const node: FillableNode = { isTextInput: false, onChangeText }

    const outcome = applyFill(node, 'x')

    expect(outcome.success).toBe(false)
    if (!outcome.success) {
      expect(outcome.code).toBe('NOT_A_TEXT_INPUT')
    }
    // No side effects when the target is rejected.
    expect(onChangeText).not.toHaveBeenCalled()
  })
})

describe('isTextInputFiber', () => {
  it('matches a TextInput by component displayName, even with NO onChangeText', () => {
    // Regression guard: an UNCONTROLLED TextInput (no onChangeText) must still be
    // recognized — prior code gated on the onChangeText prop and rejected it.
    const fiber: FiberNode = {
      type: { displayName: 'TextInput' },
      memoizedProps: { testID: 'username' },
    }
    expect(isTextInputFiber(fiber)).toBe(true)
  })

  it('matches a TextInput by component name when displayName is absent', () => {
    const fiber: FiberNode = {
      type: { name: 'TextInput' },
      memoizedProps: { testID: 'username', onChangeText: () => {} },
    }
    expect(isTextInputFiber(fiber)).toBe(true)
  })

  it('prefers elementType identity over type', () => {
    const fiber: FiberNode = {
      elementType: { displayName: 'TextInput' },
      type: { displayName: 'View' },
      memoizedProps: {},
    }
    expect(isTextInputFiber(fiber)).toBe(true)
  })

  it('rejects a non-TextInput component that merely declares onChangeText', () => {
    // A custom control sharing the onChangeText prop is NOT a text input — identity
    // gates, not props.
    const fiber: FiberNode = {
      type: { displayName: 'CustomPicker' },
      memoizedProps: { testID: 'picker', onChangeText: () => {} },
    }
    expect(isTextInputFiber(fiber)).toBe(false)
  })

  it('rejects a fiber with no resolvable component identity', () => {
    expect(isTextInputFiber({ memoizedProps: { testID: 'x' } })).toBe(false)
  })
})

describe('findFiberByTestId', () => {
  const textInput = (testID: string, extra: Record<string, unknown> = {}): FiberNode => ({
    type: { displayName: 'TextInput' },
    memoizedProps: { testID, ...extra },
  })

  it('finds an uncontrolled TextInput nested in the tree', () => {
    const target = textInput('email')
    const root: FiberNode = {
      type: { displayName: 'View' },
      memoizedProps: {},
      child: { type: { displayName: 'View' }, memoizedProps: {}, child: target },
    }
    expect(findFiberByTestId(root, 'email')).toBe(target)
  })

  it('returns null when the testID matches a non-TextInput only', () => {
    const root: FiberNode = {
      type: { displayName: 'View' },
      memoizedProps: { testID: 'email' },
    }
    expect(findFiberByTestId(root, 'email')).toBeNull()
  })

  it('returns null for a missing testID', () => {
    expect(findFiberByTestId(textInput('a'), 'b')).toBeNull()
  })

  it('returns null for an empty tree', () => {
    expect(findFiberByTestId(null, 'x')).toBeNull()
  })
})

describe('fiberToFillable', () => {
  it('builds an uncontrolled fillable from setNativeProps alone (no handlers)', () => {
    const setNativeProps = vi.fn()
    const node = fiberToFillable({
      type: { displayName: 'TextInput' },
      memoizedProps: { testID: 'x' },
      stateNode: { setNativeProps },
    })
    expect(node.isTextInput).toBe(true)
    expect(node.onChangeText).toBeUndefined()
    expect(node.setNativeProps).toBeTypeOf('function')
    node.setNativeProps?.({ text: 'v' })
    expect(setNativeProps).toHaveBeenCalledWith({ text: 'v' })
  })

  it('carries the controlled handlers through when present', () => {
    const onChangeText = vi.fn()
    const node = fiberToFillable({
      type: { displayName: 'TextInput' },
      memoizedProps: { testID: 'x', onChangeText },
    })
    expect(node.onChangeText).toBe(onChangeText)
  })
})
