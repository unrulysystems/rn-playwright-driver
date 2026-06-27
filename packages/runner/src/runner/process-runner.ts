import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process'
import { createReadStream, openSync } from 'node:fs'
import { chmod, readFile, rm, writeFile as fsWriteFile } from 'node:fs/promises'
import type { ExecResult, ProcessRunner, ReadinessProbe, SpawnHandle } from '../plan/types'

const PROBE_INTERVAL_MS = 1_000

/**
 * The real OS boundary. Foreground commands inherit stdio so build output is
 * visible; background processes (Metro, companion) are detached with output
 * captured to a per-run log file and killed by process group on teardown.
 *
 * Intended to run under bun or Node >= 22 (uses the global `WebSocket`/`fetch`
 * for readiness probes, matching the example recipes). This is the effectful
 * layer — its behavior is verified by the live e2e oracle, not unit tests.
 */
export class NodeProcessRunner implements ProcessRunner {
  private readonly children = new Map<string, ChildProcess>()

  exec(spec: CommandLike, _opts?: { logPath?: string }): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const usesStdin = Boolean(spec.stdinFromFile) || spec.stdinContents !== undefined
      const child = nodeSpawn(spec.command, [...spec.args], {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        stdio: [usesStdin ? 'pipe' : 'inherit', 'inherit', 'inherit'],
      })
      child.on('error', reject)
      if (usesStdin && child.stdin) {
        if (spec.stdinFromFile) {
          createReadStream(spec.stdinFromFile).pipe(child.stdin)
        } else {
          child.stdin.end(spec.stdinContents ?? '')
        }
      }
      child.on('close', (code) => resolve({ code: code ?? 1, stdout: '', stderr: '' }))
    })
  }

  spawn(spec: CommandLike, opts: { key: string; logPath: string }): SpawnHandle {
    const fd = openSync(opts.logPath, 'a')
    const child = nodeSpawn(spec.command, [...spec.args], {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      detached: true,
      stdio: ['ignore', fd, fd],
    })
    child.unref()
    this.children.set(opts.key, child)
    return { key: opts.key, pid: child.pid }
  }

  isAlive(handle: SpawnHandle): boolean {
    const child = this.children.get(handle.key)
    if (!child || child.exitCode !== null || child.signalCode !== null) return false
    if (handle.pid === undefined) return false
    try {
      process.kill(handle.pid, 0)
      return true
    } catch {
      return false
    }
  }

  async kill(handle: SpawnHandle): Promise<void> {
    const child = this.children.get(handle.key)
    if (!child || handle.pid === undefined) return
    // Kill the whole process group: a detached child (xcodebuild/am instrument)
    // spawns its own children that outlive a bare parent kill.
    killGroup(handle.pid, 'SIGTERM')
    await delay(500)
    if (this.isAlive(handle)) killGroup(handle.pid, 'SIGKILL')
    this.children.delete(handle.key)
  }

  async writeFile(path: string, contents: string, mode?: number): Promise<void> {
    await fsWriteFile(path, contents)
    if (mode !== undefined) await chmod(path, mode)
  }

  async removeFile(path: string): Promise<void> {
    await rm(path, { force: true })
  }

  async freePort(port: number): Promise<void> {
    // The sim/device-hosted companion binds the host loopback, so it is visible
    // and killable via lsof on the host even though it runs "inside" the device.
    const pids = await this.lsofPids(port)
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // already gone
      }
    }
    if (pids.length > 0) await delay(1_000)
  }

  probe(probe: ReadinessProbe, isAlive: () => boolean): Promise<boolean> {
    const deadline = Date.now() + probe.timeoutMs
    const attempt = async (): Promise<boolean> => {
      for (;;) {
        if (!isAlive()) return false
        if (await probeOnce(probe)) return true
        if (Date.now() >= deadline) return false
        await delay(PROBE_INTERVAL_MS)
      }
    }
    return attempt()
  }

  log(line: string): void {
    process.stderr.write(`${line}\n`)
  }

  private lsofPids(port: number): Promise<number[]> {
    return new Promise((resolve) => {
      const child = nodeSpawn('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      let out = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        out += chunk.toString()
      })
      child.on('error', () => resolve([]))
      child.on('close', () => {
        const pids = out
          .split('\n')
          .map((line) => Number.parseInt(line.trim(), 10))
          .filter((pid) => Number.isInteger(pid) && pid > 0)
        resolve(pids)
      })
    })
  }
}

interface CommandLike {
  readonly command: string
  readonly args: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
  readonly stdinFromFile?: string
  readonly stdinContents?: string
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal) // negative pid → process group
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      // already gone
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function probeOnce(probe: ReadinessProbe): Promise<boolean> {
  switch (probe.kind) {
    case 'metro-status':
      return metroStatusOk(probe.metroUrl)
    case 'hermes-target':
      return hermesTargetPresent(probe)
    case 'xctest-hello':
      return xctestHelloOk(probe.port, probe.tokenFile)
    case 'instrumentation-hello':
      return instrumentationHelloOk(probe.port, probe.tokenFile)
    default: {
      const _exhaustive: never = probe
      throw new Error(`unhandled probe: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

async function metroStatusOk(metroUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${metroUrl}/status`)
    const body = await response.text()
    return body.includes('packager-status:running')
  } catch {
    return false
  }
}

interface MetroTarget {
  readonly title?: string
  readonly description?: string
  readonly vm?: string
  readonly appId?: string
  readonly deviceName?: string
}

async function hermesTargetPresent(
  probe: Extract<ReadinessProbe, { kind: 'hermes-target' }>,
): Promise<boolean> {
  try {
    const response = await fetch(`${probe.metroUrl}/json`)
    if (!response.ok) return false
    const targets = (await response.json()) as MetroTarget[]
    return targets.some((target) => {
      const isReactNative =
        String(target.title ?? '').includes('Hermes') ||
        target.vm === 'Hermes' ||
        String(target.description ?? '').includes('React Native')
      if (!isReactNative || target.appId !== probe.appId) return false
      if (!probe.deviceNameMatch) return true
      return String(target.deviceName ?? '').includes(probe.deviceNameMatch)
    })
  } catch {
    return false
  }
}

async function xctestHelloOk(port: number, tokenFile: string): Promise<boolean> {
  const WebSocketCtor = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket
  if (!WebSocketCtor)
    throw new Error(
      'global WebSocket is required for the xctest probe (run under bun or Node >= 22)',
    )
  const authToken = await readTokenFile(tokenFile)
  return new Promise((resolve) => {
    const socket = new WebSocketCtor(`ws://127.0.0.1:${port}`)
    const timer = setTimeout(() => {
      close(socket)
      resolve(false)
    }, PROBE_INTERVAL_MS)
    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          id: 1,
          type: 'hello',
          protocolVersion: 1,
          client: 'rn-driver-runner',
          ...(authToken ? { authToken } : {}),
        }),
      )
    })
    socket.addEventListener('message', (event: MessageEvent) => {
      clearTimeout(timer)
      close(socket)
      try {
        const payload = JSON.parse(String(event.data)) as { id?: number; ok?: boolean }
        resolve(payload.id === 1 && payload.ok === true)
      } catch {
        resolve(false)
      }
    })
    socket.addEventListener('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

async function instrumentationHelloOk(port: number, tokenFile: string): Promise<boolean> {
  try {
    const token = await readTokenFile(tokenFile)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_INTERVAL_MS)
    const response = await fetch(`http://127.0.0.1:${port}/command`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { 'x-rn-driver-auth': token } : {}),
      },
      body: JSON.stringify({ type: 'hello' }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    const payload = (await response.json().catch(() => undefined)) as { ok?: boolean } | undefined
    return response.ok && payload?.ok === true
  } catch {
    return false
  }
}

async function readTokenFile(path: string): Promise<string | undefined> {
  try {
    const token = (await readFile(path, 'utf8')).trim()
    return token === '' ? undefined : token
  } catch {
    return undefined
  }
}

function close(socket: WebSocket): void {
  try {
    socket.close()
  } catch {
    // ignore
  }
}
