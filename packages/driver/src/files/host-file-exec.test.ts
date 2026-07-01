import { describe, expect, it } from 'vitest'
import { createDefaultHostFileExec, HostExecMaxBufferError } from './host-file-exec'

// Integration-level: spawns the Node binary so the real spawn/stream/limit code
// runs (the transports depend on exactly these bounds). No app or device needed.
const node = process.execPath

describe('createDefaultHostFileExec', () => {
  it('captures stdout as a binary-safe Buffer and reports the exit code', async () => {
    const exec = createDefaultHostFileExec()
    const result = await exec(node, ['-e', 'process.stdout.write(Buffer.from([0,1,2,255]))'])
    expect([...result.stdout]).toEqual([0, 1, 2, 255])
    expect(result.code).toBe(0)
  })

  it('writes options.stdin to the child', async () => {
    const exec = createDefaultHostFileExec()
    const result = await exec(node, ['-e', 'process.stdin.pipe(process.stdout)'], {
      stdin: Buffer.from('piped-in'),
    })
    expect(result.stdout.toString()).toBe('piped-in')
  })

  it('rejects with HostExecMaxBufferError once stdout exceeds maxBuffer', async () => {
    const exec = createDefaultHostFileExec()
    await expect(
      exec(node, ['-e', 'process.stdout.write("x".repeat(10000))'], { maxBuffer: 100 }),
    ).rejects.toBeInstanceOf(HostExecMaxBufferError)
  })

  it('bounds buffered stderr so a flood cannot exhaust worker memory', async () => {
    const exec = createDefaultHostFileExec()
    // Emit ~2 MiB to stderr; the cap keeps only the first ~256 KiB, not all of it.
    const result = await exec(node, ['-e', 'process.stderr.write("x".repeat(2_000_000))'])
    expect(result.code).toBe(0)
    expect(result.stderr.length).toBeGreaterThan(0)
    expect(result.stderr.length).toBeLessThan(600_000)
  })

  it('resolves cleanly when the child exits before consuming a large stdin payload', async () => {
    const exec = createDefaultHostFileExec()
    // Child exits immediately; writing a big stdin payload would EPIPE. The
    // wrapper must not surface that as an unhandled stream error (REQ-FILES-007).
    const result = await exec(node, ['-e', 'process.exit(3)'], {
      stdin: Buffer.alloc(1_000_000, 0x61),
    })
    expect(result.code).toBe(3)
  })

  it('kills the child and rejects when it exceeds timeoutMs', async () => {
    const exec = createDefaultHostFileExec()
    await expect(
      exec(node, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 150 }),
    ).rejects.toThrow(/timed out/)
  })
})
