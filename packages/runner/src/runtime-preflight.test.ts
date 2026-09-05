import { describe, expect, it } from 'vitest'
import { runtimePreflight } from './runtime-preflight'

describe('runtimePreflight (REQ-CLI-008)', () => {
  const ok = { WebSocket: class {}, fetch: () => undefined }

  it('accepts a runtime that exposes WebSocket and fetch', () => {
    expect(runtimePreflight('v22.12.0', ok)).toBeUndefined()
  })

  it('names the missing global, the running version, and the supported runtimes', () => {
    const message = runtimePreflight('v20.20.0', { fetch: ok.fetch })
    expect(message).toContain('v20.20.0')
    expect(message).toContain('WebSocket')
    expect(message).toContain('Node >= 22 or bun')
  })

  it('lists every missing global', () => {
    expect(runtimePreflight('v18.0.0', {})).toContain('WebSocket or fetch')
  })
})
