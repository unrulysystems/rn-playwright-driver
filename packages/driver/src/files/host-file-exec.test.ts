import { describe, expect, it } from 'vitest'
import {
  createDefaultHostFileExec,
  DEFAULT_STDOUT_CAP,
  HostExecMaxBufferError,
  STDERR_CAP,
} from './host-file-exec'

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

  it('bounds stdout by a default cap when maxBuffer is omitted (control commands)', async () => {
    // simctl/devicectl/adb-push omit maxBuffer; a broken/hostile CLI flooding stdout
    // must still be killed rather than buffer unbounded (REQ-FILES-008).
    const exec = createDefaultHostFileExec()
    await expect(
      exec(node, ['-e', `process.stdout.write("x".repeat(${DEFAULT_STDOUT_CAP + 1_000_000}))`]),
    ).rejects.toBeInstanceOf(HostExecMaxBufferError)
  })

  it('bounds buffered stderr so a flood cannot exhaust worker memory', async () => {
    const exec = createDefaultHostFileExec()
    // Emit ~2 MiB to stderr; the cap keeps EXACTLY the first STDERR_CAP bytes
    // (the crossing chunk is truncated), not all of it.
    const result = await exec(node, ['-e', 'process.stderr.write("x".repeat(2_000_000))'])
    expect(result.code).toBe(0)
    expect(result.stderr.length).toBe(STDERR_CAP)
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
