import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * REQ-SEAM-005: `harness/dev` installs under `__DEV__` alone. Metro inlines
 * `__DEV__` and folds the branch out of release graphs before it collects
 * dependencies, so a runtime-only gate (the former `globalThis.__E2E__`) would
 * keep the whole harness in a release bundle. The driver attaches through
 * Metro's CDP endpoint, which only a dev bundle exposes, so nothing is lost.
 */

declare global {
  var __DEV__: boolean | undefined
  var __E2E__: boolean | undefined
}

/** The dev entry installs through a dynamic import; give a would-be install a full turn to land. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('harness/dev', () => {
  beforeEach(() => {
    vi.resetModules()
    globalThis.__RN_DRIVER__ = undefined
    globalThis.requestAnimationFrame = () => 0
  })

  afterEach(() => {
    globalThis.__E2E__ = undefined
    globalThis.__DEV__ = undefined
  })

  it('installs the harness in a dev bundle', async () => {
    globalThis.__DEV__ = true
    await import('./dev')
    await vi.waitFor(() => expect(globalThis.__RN_DRIVER__).toBeDefined())
  })

  it('installs nothing in a release bundle', async () => {
    globalThis.__DEV__ = false
    await import('./dev')
    await settle()
    expect(globalThis.__RN_DRIVER__).toBeUndefined()
  })

  it('ignores the legacy __E2E__ runtime flag so the release branch stays foldable', async () => {
    globalThis.__DEV__ = false
    globalThis.__E2E__ = true
    await import('./dev')
    await settle()
    expect(globalThis.__RN_DRIVER__).toBeUndefined()
  })
})
