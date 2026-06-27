import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process'
import { createReadStream, openSync } from 'node:fs'
import { chmod, readFile, rm, writeFile as fsWriteFile } from 'node:fs/promises'
import type {
  CommandSpec,
  ExecResult,
  ProbeWatch,
  ProcessRunner,
  ReadinessProbe,
  SpawnHandle,
} from '../plan/types'
import { findFailureMarker, ProbeFailure } from './probe-failure'

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

  exec(spec: CommandSpec, _opts?: { logPath?: string }): Promise<ExecResult> {
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

  spawn(spec: CommandSpec, opts: { key: string; logPath: string }): SpawnHandle {
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

  /**
   * Best-effort synchronous teardown for signal handlers: SIGKILL every tracked
   * child's process group so a Ctrl-C / SIGTERM does not orphan the detached
   * Metro/companion processes (REQ-CLEAN-001, signal clause). Synchronous because
   * a signal handler cannot await before `process.exit`.
   */
  killAll(): void {
    for (const child of this.children.values()) {
      if (child.pid !== undefined) killGroup(child.pid, 'SIGKILL')
    }
    this.children.clear()
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
    // This SIGTERMs whatever LISTENs on the port — the companion port is assumed
    // DEDICATED to the runner's companion (config `*.companion.port`, default
    // 9999). Do not point it at a port shared with an unrelated service.
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

  probe(probe: ReadinessProbe, isAlive: () => boolean, watch?: ProbeWatch): Promise<boolean> {
    const deadline = Date.now() + probe.timeoutMs
    const attempt = async (): Promise<boolean> => {
      for (;;) {
        // Fail fast: a terminal build/test failure marker in the backing process's log means it will
        // never become ready, so abort now (throwing the real error) instead of polling until the
        // cold-build timeout. Checked BEFORE isAlive because a failed `xcodebuild test` lingers
        // "alive" doing reporting after it has already printed `** BUILD FAILED **`.
        if (watch) {
          const log = await readWatchedLog(watch.logPath)
          const marker = findFailureMarker(log, watch.failureMarkers)
          if (marker) throw new ProbeFailure(marker, lastLines(log, 12))
        }
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

/**
 * Read a watched companion log for the fast-fail marker scan — FAIL-CLOSED.
 *
 * `spawn()` creates the log file synchronously (`openSync(logPath, 'a')`) before the
 * companion-ready probe ever polls, and the companion is never a skipped step, so the file is
 * guaranteed to exist whenever a watched probe reads it. Any read failure (missing file, `EACCES`,
 * `EISDIR`, removed/locked log) therefore signals a real defect — the wrong log path or a broken
 * watch — not an expected transient. Swallowing it to `''` would silently disable marker detection
 * and revert to the opaque 300s readiness timeout, hiding the underlying defect. Surface it loudly.
 */
export async function readWatchedLog(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    // The CLI surfaces `error.message` only (see cli.ts), so the underlying cause must live IN the
    // message — not just in `cause` — for the real reason (EACCES / EISDIR / missing path) to reach
    // the user instead of an opaque "cannot read" line.
    throw new Error(
      `cannot read companion log for fast-fail marker detection (${path}): ${String(error)}`,
      { cause: error },
    )
  }
}

/** The last `n` non-empty lines of a log, for surfacing the failing build/test context in the error. */
function lastLines(text: string, n: number): string {
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .slice(-n)
    .join('\n')
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
    // AbortSignal bounds a single attempt: without it a server that accepts the
    // socket but stalls before headers/body would hang the poll loop past its
    // deadline, since probe() only re-checks the deadline between attempts.
    const response = await fetch(`${metroUrl}/status`, {
      signal: AbortSignal.timeout(PROBE_INTERVAL_MS),
    })
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
    const response = await fetch(`${probe.metroUrl}/json`, {
      signal: AbortSignal.timeout(PROBE_INTERVAL_MS),
    })
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
