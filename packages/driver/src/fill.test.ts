import { describe, expect, it, vi } from 'vitest'

import { applyFill, type FillableNode } from './fill'

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
