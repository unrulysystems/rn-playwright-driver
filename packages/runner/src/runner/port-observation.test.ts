import { spawn, type ChildProcess } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { createServer, type AddressInfo } from 'node:net'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FreePortSpec } from '../plan/types'
import { classifyPortHolders, PortOwnershipError } from './port-ownership'
import { NodeProcessRunner, observePortListeners, observeProcess } from './process-runner'

/**
 * Real-OS observation tests: these spawn actual host processes and observe them through the same
 * `ps`/`lsof` calls the executor uses, so the classifiers are proven against REAL `ps` output
 * shapes (not just crafted strings). POSIX only.
 */

const SIM = '0089EDC0-38EB-47D7-8E68-DB4CB80BAD99'
const DEVICE_UDID = '00008101-001C0A0C3C00001E'
const RUNNER = 'exampleUITests-Runner'

const children: ChildProcess[] = []
const tempDirs: string[] = []

function spawnTracked(command: string, args: readonly string[]): ChildProcess {
  const child = spawn(command, [...args], { stdio: 'ignore' })
  children.push(child)
  return child
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'rn-driver-observation-'))
  tempDirs.push(dir)
  return dir
}

function childAlive(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null
}

async function waitFor<T>(probe: () => Promise<T | undefined>, what: string): Promise<T> {
  const deadline = Date.now() + 10_000
  for (;;) {
    const value = await probe().catch(() => undefined)
    if (value !== undefined) return value
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

function freePortNumber(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      server.close(() => resolve(address.port))
    })
  })
}

let hasPython3 = false
try {
  execFileSync('python3', ['--version'], { stdio: 'ignore' })
  hasPython3 = true
} catch {
  hasPython3 = false
}

afterEach(() => {
  for (const child of children.splice(0)) {
    if (childAlive(child)) child.kill('SIGKILL')
  }
  for (const dir of tempDirs.splice(0)) {
    rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
})

describe.skipIf(process.platform === 'win32')('real-OS process observation (ps/lsof)', () => {
  it('observes comm as the kernel-reported executable path — spaces preserved — and the sim classifier claims it', async () => {
    // A symlinked real binary reports the INVOCATION path as comm (verified against macOS ps):
    // this stands in for the XCTest runner executable without compiling anything.
    const dir = await makeTempDir()
    const runnerPath = path.join(
      dir,
      'Library/Developer/CoreSimulator/Devices',
      SIM,
      'data/Containers/Bundle/Application/1F',
      `${RUNNER}.app/${RUNNER}`,
    )
    await mkdir(path.dirname(runnerPath), { recursive: true })
    await symlink('/bin/sleep', runnerPath)
    const child = spawnTracked(runnerPath, ['30'])

    const observed = await waitFor(() => observeProcess(child.pid!), 'process observation')
    expect(observed?.pid).toBe(child.pid)
    // Real ps shape: comm is the executable path, quoted/space-joined args mirror it.
    expect(observed?.comm).toBe(runnerPath)
    expect(observed?.args.startsWith(runnerPath)).toBe(true)

    // The real observation flows through the real classifier: owned by the simulator spec.
    const spec: FreePortSpec = {
      port: 9999,
      owner: { platform: 'ios', kind: 'simulator', simUdid: SIM, runnerExecutable: RUNNER },
      freeUnowned: false,
    }
    const plan = classifyPortHolders(spec, { listeners: [observed], forwards: [] })
    expect(plan.killPids).toEqual([child.pid])
    expect(plan.foreign).toEqual([])
  })

  it('a real node listener on the port is foreign to an iOS owner: freePort fails naming it and kills nothing', async () => {
    const port = await freePortNumber()
    const marker = 'rn-driver-observation-marker'
    const child = spawnTracked(process.execPath, [
      '-e',
      `require('node:http').createServer().listen(${port}, '127.0.0.1')`,
      marker,
    ])
    await waitFor(async () => {
      const listeners = await observePortListeners(port)
      return listeners.length > 0 ? listeners : undefined
    }, `listener on port ${port}`)

    const spec: FreePortSpec = {
      port,
      owner: { platform: 'ios', kind: 'simulator', simUdid: SIM, runnerExecutable: RUNNER },
      freeUnowned: false,
    }
    const error = await new NodeProcessRunner().freePort(spec).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PortOwnershipError)
    expect((error as PortOwnershipError).message).toContain(`pid ${child.pid}`)
    expect((error as PortOwnershipError).message).toContain(marker)
    // Nothing was killed: the foreign holder is still alive.
    expect(childAlive(child)).toBe(true)
  })

  it('freeUnowned reclaims a real foreign listener (SIGTERM through the real free path)', async () => {
    const port = await freePortNumber()
    const child = spawnTracked(process.execPath, [
      '-e',
      `require('node:http').createServer().listen(${port}, '127.0.0.1')`,
    ])
    await waitFor(async () => {
      const listeners = await observePortListeners(port)
      return listeners.length > 0 ? listeners : undefined
    }, `listener on port ${port}`)

    const spec: FreePortSpec = {
      port,
      owner: { platform: 'ios', kind: 'simulator', simUdid: SIM, runnerExecutable: RUNNER },
      freeUnowned: true,
    }
    await new NodeProcessRunner().freePort(spec)
    await waitFor(async () => (childAlive(child) ? undefined : 'reaped'), 'listener reaped')
  })

  it.runIf(hasPython3)(
    'recognizes a REAL python entry-point forward: interpreter comm + resolved script argv through ps',
    async () => {
      const dir = await makeTempDir()
      const script = path.join(dir, 'pymobiledevice3')
      const port = await freePortNumber()
      // Stands in for the real pymobiledevice3 CLI: binds the local port, then sleeps.
      await writeFile(
        script,
        [
          '#!/usr/bin/env python3',
          'import socket, sys, time',
          `local = int(sys.argv[5])`,
          's = socket.socket()',
          's.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)',
          "s.bind(('127.0.0.1', local))",
          's.listen(1)',
          'time.sleep(60)',
        ].join('\n'),
      )
      const child = spawnTracked('python3', [
        script,
        'usbmux',
        'forward',
        '--serial',
        DEVICE_UDID,
        String(port),
        String(port),
      ])
      const observed = await waitFor(async () => {
        const listeners = await observePortListeners(port)
        return listeners.find((l) => l.pid === child.pid)
      }, `python forward listener on port ${port}`)

      // Real ps shape for a shebang entry point: comm is the interpreter, argv[1] is the script.
      expect(path.basename(observed.args.split(' ')[1] ?? '')).toBe('pymobiledevice3')

      const spec: FreePortSpec = {
        port,
        owner: { platform: 'ios', kind: 'device', serial: DEVICE_UDID },
        freeUnowned: false,
      }
      const plan = classifyPortHolders(spec, { listeners: [observed], forwards: [] })
      expect(plan.killPids).toEqual([child.pid])
      expect(plan.foreign).toEqual([])
    },
  )

  it.runIf(hasPython3)(
    'a REAL python -c process whose code mentions the UDID stays foreign',
    async () => {
      const port = await freePortNumber()
      const child = spawnTracked('python3', [
        '-c',
        `import socket,time; s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); ` +
          `s.bind(('127.0.0.1', ${port})); s.listen(1); exec("cmd = 'usbmux forward --serial ${DEVICE_UDID} ${port} ${port}'"); time.sleep(60)`,
      ])
      const observed = await waitFor(async () => {
        const listeners = await observePortListeners(port)
        return listeners.find((l) => l.pid === child.pid)
      }, `python -c listener on port ${port}`)

      const spec: FreePortSpec = {
        port,
        owner: { platform: 'ios', kind: 'device', serial: DEVICE_UDID },
        freeUnowned: false,
      }
      const plan = classifyPortHolders(spec, { listeners: [observed], forwards: [] })
      expect(plan.killPids).toEqual([])
      expect(plan.foreign).toEqual([{ kind: 'process', pid: child.pid, args: observed.args }])
      // Fail closed means fail SAFE here: an unrecognized holder is reported, never killed.
      expect(childAlive(child)).toBe(true)
    },
  )
})
