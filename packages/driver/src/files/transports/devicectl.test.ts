import { describe, expect, it } from 'vitest'
import { FileIoError } from '../errors'
import type { HostExecResult, HostFileExec } from '../host-file-exec'
import { type HostFs, HostFileTooLargeError } from '../host-fs'
import { createDevicectlTransport } from './devicectl'

/** Shared bounded-read shim for the standalone HostFs fakes below. */
const boundedFrom = (fs: Pick<HostFs, 'readFile'>) => async (path: string, maxBytes: number) => {
  const bytes = await fs.readFile(path)
  if (bytes.length > maxBytes) throw new HostFileTooLargeError(maxBytes)
  return bytes
}

const CONFIG = { udid: 'UDID-1', bundleId: 'com.acme.app', xcrunPath: 'xcrun' }

// A HostFileExec that REJECTS (spawn failure / timeout — xcrun missing/killed),
// distinct from a nonzero-exit HostExecResult. Shared by the pull/push typed-error
// tests (REQ-FILES-007).
const spawnRejectExec: HostFileExec = async () => {
  throw Object.assign(new Error('spawn xcrun ENOENT'), { code: 'ENOENT' })
}

type Call = { command: string; args: string[] }

function fakeExec(impl: (call: Call) => HostExecResult) {
  const calls: Call[] = []
  const exec: HostFileExec = async (command, args) => {
    const call = { command, args: [...args] }
    calls.push(call)
    return impl(call)
  }
  return { exec, calls }
}

function fakeFs(files: Record<string, string> = {}) {
  const removed: string[] = []
  const written: [string, Buffer][] = []
  const fs: HostFs = {
    readFile: async (path) => {
      if (path in files) return Buffer.from(files[path] as string)
      if (path.endsWith('payload')) return Buffer.from('DATA')
      throw Object.assign(new Error('enoent'), { code: 'ENOENT' })
    },
    readFileBounded: async (path, maxBytes) => {
      const bytes = await fs.readFile(path)
      if (bytes.length > maxBytes) throw new HostFileTooLargeError(maxBytes)
      return bytes
    },
    writeFile: async (path, data) => {
      written.push([path, data])
    },
    mkdtempDir: async () => '/tmp/dc',
    remove: async (path) => {
      removed.push(path)
    },
    realpath: async (path) => path,
    size: async () => 4, // 'DATA'; size-guard tests override
  }
  return { fs, removed, written }
}

const ok = (): HostExecResult => ({ stdout: Buffer.alloc(0), stderr: '', code: 0 })

describe('devicectl transport (provisional, REQ-XPORT-003)', () => {
  it('copies FROM the container to a host temp then reads it', async () => {
    const { exec, calls } = fakeExec(ok)
    const { fs, removed } = fakeFs()
    const transport = createDevicectlTransport(CONFIG, exec, fs)

    const bytes = await transport.pull(
      { absolute: false, subpath: 'Documents/obs.csv' },
      { maxBuffer: 4096 },
    )

    expect(calls[0]).toEqual({
      command: 'xcrun',
      args: [
        'devicectl',
        'device',
        'copy',
        'from',
        '--device',
        'UDID-1',
        '--domain-type',
        'appDataContainer',
        '--domain-identifier',
        'com.acme.app',
        '--source',
        'Documents/obs.csv',
        '--destination',
        '/tmp/dc/payload',
        '--json-output',
        '/tmp/dc/result.json',
      ],
    })
    expect(bytes.toString()).toBe('DATA')
    expect(removed).toEqual(['/tmp/dc']) // temp dir always cleaned up
  })

  it('copies TO the container from a staged host temp on push', async () => {
    const { exec, calls } = fakeExec(ok)
    const { fs, written } = fakeFs()
    const transport = createDevicectlTransport(CONFIG, exec, fs)

    await transport.push({ absolute: false, subpath: 'Documents/seed.json' }, Buffer.from('x'))

    expect(written[0]?.[0]).toBe('/tmp/dc/payload')
    expect(calls[0]?.args).toEqual([
      'devicectl',
      'device',
      'copy',
      'to',
      '--device',
      'UDID-1',
      '--domain-type',
      'appDataContainer',
      '--domain-identifier',
      'com.acme.app',
      '--source',
      '/tmp/dc/payload',
      '--destination',
      'Documents/seed.json',
      '--json-output',
      '/tmp/dc/result.json',
    ])
  })

  it('rejects with a typed FileIoError INSTANCE, not a plain object carrying a code', async () => {
    // The public contract promises every failure is a FileIoError (README/SPEC); assert
    // the instance so a regression in classifyCliFailure/assertOk error construction is caught.
    const { exec } = fakeExec(() => ({
      stdout: Buffer.alloc(0),
      stderr: 'The requested file does not exist.',
      code: 1,
    }))
    const { fs } = fakeFs()
    const error = await createDevicectlTransport(CONFIG, exec, fs)
      .pull({ absolute: false, subpath: 'Documents/x' }, { maxBuffer: 1 })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(FileIoError)
    expect((error as FileIoError).code).toBe('NOT_FOUND')
  })

  it('fails closed on a nonzero `copy to` exit — push checks assertOk, never silent success', async () => {
    // The staging write succeeds, but `devicectl device copy to` exits nonzero (device
    // write failed). push MUST assertOk the copy-to result — a regression that drops that
    // check would report a FAILED device write as success. Guards devicectl.ts:182.
    const { exec, calls } = fakeExec(() => ({
      stdout: Buffer.alloc(0),
      stderr: 'devicectl copy to failed',
      code: 1,
    }))
    const { fs, removed } = fakeFs()
    await expect(
      createDevicectlTransport(CONFIG, exec, fs).push(
        { absolute: false, subpath: 'Documents/seed.json' },
        Buffer.from('x'),
      ),
    ).rejects.toMatchObject({ code: 'TRANSPORT_FAILED' })
    expect(calls[0]?.args[3]).toBe('to') // it did attempt `copy to` before failing closed
    expect(removed).toEqual(['/tmp/dc']) // and still cleaned up staging
  })

  it('classifies a missing source as NOT_FOUND and still cleans up the staging dir', async () => {
    const { exec } = fakeExec(() => ({
      stdout: Buffer.alloc(0),
      stderr: 'The requested file does not exist.',
      code: 1,
    }))
    const { fs, removed } = fakeFs()
    await expect(
      createDevicectlTransport(CONFIG, exec, fs).pull(
        { absolute: false, subpath: 'Documents/x' },
        { maxBuffer: 1 },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    // The `finally { remove(dir) }` must fire on the CLI-failure path too — a leaked
    // staging temp dir per failed pull would accumulate. Guards the pull cleanup branch.
    expect(removed).toEqual(['/tmp/dc'])
  })

  it('reads the --json-output diagnostic (not just stderr) to classify a failure', async () => {
    // stderr alone is unclassifiable (would be TRANSPORT_FAILED); the NOT_FOUND signal
    // lives ONLY in the --json-output file, so a NOT_FOUND verdict proves assertOk
    // reads result.json and folds it into the diagnostic before classifying.
    const { exec } = fakeExec(() => ({
      stdout: Buffer.alloc(0),
      stderr: 'devicectl exited with error',
      code: 1,
    }))
    const { fs } = fakeFs({
      '/tmp/dc/result.json': '{"error":{"message":"The requested file does not exist."}}',
    })
    await expect(
      createDevicectlTransport(CONFIG, exec, fs).pull(
        { absolute: false, subpath: 'Documents/x' },
        { maxBuffer: 1 },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('maps a spawn-level devicectl rejection (pull) to TRANSPORT_FAILED', async () => {
    // runCopy must surface a FileIoError, not leak a raw Node error (REQ-FILES-007).
    const { fs } = fakeFs()
    await expect(
      createDevicectlTransport(CONFIG, spawnRejectExec, fs).pull(
        { absolute: false, subpath: 'Documents/x' },
        { maxBuffer: 1 },
      ),
    ).rejects.toMatchObject({ code: 'TRANSPORT_FAILED' })
  })

  it('maps a spawn-level devicectl rejection (push) to TRANSPORT_FAILED', async () => {
    const { fs } = fakeFs()
    await expect(
      createDevicectlTransport(CONFIG, spawnRejectExec, fs).push(
        { absolute: false, subpath: 'Documents/seed.json' },
        Buffer.from('x'),
      ),
    ).rejects.toMatchObject({ code: 'TRANSPORT_FAILED' })
  })

  it('rejects the absolute root as UNSUPPORTED (container-scoped)', async () => {
    const { exec, calls } = fakeExec(ok)
    const { fs } = fakeFs()
    await expect(
      createDevicectlTransport(CONFIG, exec, fs).pull(
        { absolute: true, path: '/var/x' },
        { maxBuffer: 1 },
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    expect(calls).toHaveLength(0)
  })

  it('rejects TOO_LARGE when the staged payload exceeds maxBuffer, before reading it', async () => {
    const { exec } = fakeExec(ok)
    const reads: string[] = []
    const { fs } = fakeFs()
    const guarded: HostFs = {
      ...fs,
      size: async () => 5_000,
      readFile: async (p) => {
        reads.push(p)
        return Buffer.from('DATA')
      },
    }
    await expect(
      createDevicectlTransport(CONFIG, exec, guarded).pull(
        { absolute: false, subpath: 'Documents/big.bin' },
        { maxBuffer: 1_000 },
      ),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' })
    expect(reads).toEqual([]) // bounded before the read
  })

  it('rejects TOO_LARGE when the staged payload grows past the size probe (bounded read, REQ-FILES-008)', async () => {
    // Size probe passes (0), but the bounded read detects the staged file grew over
    // the cap and throws HostFileTooLargeError — devicectl must map it to TOO_LARGE,
    // symmetric with simctl. Guards the devicectl.ts readFileBounded/mapping branch.
    const { exec } = fakeExec(ok)
    const { fs } = fakeFs()
    const grown: HostFs = {
      ...fs,
      size: async () => 0, // passes the fast-fail
      readFileBounded: async (_p, maxBytes) => {
        throw new HostFileTooLargeError(maxBytes) // the bounded read detects the growth
      },
    }
    await expect(
      createDevicectlTransport(CONFIG, exec, grown).pull(
        { absolute: false, subpath: 'Documents/grows.bin' },
        { maxBuffer: 1_000 },
      ),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' })
  })

  it('maps a staged-payload read failure to TRANSPORT_FAILED, not NOT_FOUND (REQ-FILES-007)', async () => {
    // `copy from` succeeded, so the remote file existed; a missing/unreadable
    // HOST-staged payload is a staging failure, not a missing remote file.
    const { exec } = fakeExec(ok)
    const removed: string[] = []
    const fs: HostFs = {
      readFile: async () => {
        throw Object.assign(new Error('enoent'), { code: 'ENOENT' })
      },
      readFileBounded: (p, m) => boundedFrom(fs)(p, m),
      writeFile: async () => {},
      mkdtempDir: async () => '/tmp/dc',
      remove: async (p) => {
        removed.push(p)
      },
      realpath: async (path) => path,
      size: async () => 0,
    }
    await expect(
      createDevicectlTransport(CONFIG, exec, fs).pull(
        { absolute: false, subpath: 'Documents/x' },
        { maxBuffer: 1 },
      ),
    ).rejects.toMatchObject({ code: 'TRANSPORT_FAILED' })
    expect(removed).toEqual(['/tmp/dc']) // staging cleaned up even when the host read fails
  })

  it('maps a staging write failure to TRANSPORT_FAILED, not NOT_FOUND, on push (REQ-FILES-007)', async () => {
    // ENOENT on the HOST staging write must not be mislabeled a remote NOT_FOUND
    // (mapNodeFsError would have done that) — it is a staging/transport failure.
    const { exec } = fakeExec(ok)
    const removed: string[] = []
    const fs: HostFs = {
      readFile: async () => Buffer.from('x'),
      readFileBounded: (p, m) => boundedFrom(fs)(p, m),
      writeFile: async () => {
        throw Object.assign(new Error('enoent'), { code: 'ENOENT' })
      },
      mkdtempDir: async () => '/tmp/dc',
      remove: async (p) => {
        removed.push(p)
      },
      realpath: async (path) => path,
      size: async () => 0,
    }
    await expect(
      createDevicectlTransport(CONFIG, exec, fs).push(
        { absolute: false, subpath: 'Documents/x' },
        Buffer.from('x'),
      ),
    ).rejects.toMatchObject({ code: 'TRANSPORT_FAILED' })
    // push stages the payload into the temp dir before `copy to`; the `finally` must
    // remove it even when the host staging write throws. Guards the push cleanup branch.
    expect(removed).toEqual(['/tmp/dc'])
  })

  it('maps a staging-dir creation failure to TRANSPORT_FAILED (REQ-FILES-007)', async () => {
    const { exec } = fakeExec(ok)
    const fs: HostFs = {
      readFile: async () => Buffer.from('x'),
      readFileBounded: (p, m) => boundedFrom(fs)(p, m),
      writeFile: async () => {},
      mkdtempDir: async () => {
        throw new Error('no temp available')
      },
      remove: async () => {},
      realpath: async (path) => path,
      size: async () => 0,
    }
    await expect(
      createDevicectlTransport(CONFIG, exec, fs).pull(
        { absolute: false, subpath: 'Documents/x' },
        { maxBuffer: 1 },
      ),
    ).rejects.toMatchObject({ code: 'TRANSPORT_FAILED' })
  })

  it('passes a nested subpath verbatim as the --destination argv (REQ-FILES-006, argv-only)', async () => {
    // ARGV COVERAGE ONLY: this asserts the driver forwards the nested
    // container-relative path unchanged. Whether `devicectl device copy to`
    // actually creates the intermediate container directories is a device-side
    // behavior verified by the pending real-device walkthrough (iOS-device ships
    // provisional), NOT proven here — the fake HostFileExec always succeeds.
    const { exec, calls } = fakeExec(ok)
    const { fs } = fakeFs()
    await createDevicectlTransport(CONFIG, exec, fs).push(
      { absolute: false, subpath: 'Documents/exports/2026/seed.json' },
      Buffer.from('x'),
    )
    const destIdx = calls[0]?.args.indexOf('--destination') ?? -1
    expect(calls[0]?.args[destIdx + 1]).toBe('Documents/exports/2026/seed.json')
  })
})
