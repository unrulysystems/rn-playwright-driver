import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type AddressInfo } from 'node:net'
import { copyFile, mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FreePortSpec } from '../plan/types'
import { classifyPortHolders, PortOwnershipError } from './port-ownership'
import { NodeProcessRunner, observePortListeners, observeProcess } from './process-runner'

/**
 * Real-OS observation tests: these spawn actual host processes and observe them through the same
 * OS observation the executor uses. macOS uses lsof mapped paths; Linux uses /proc/<pid>/exe.
 * Both require lsof for listeners, ps for full arguments, and Python 3 for forward fixtures.
 */

const SIM = '0089EDC0-38EB-47D7-8E68-DB4CB80BAD99'
const DEVICE_UDID = '00008101-001C0A0C3C00001E'
const RUNNER = 'exampleUITests-Runner'

const children: ChildProcess[] = []
const tempDirs: string[] = []

function spawnTracked(command: string, args: readonly string[], argv0?: string): ChildProcess {
  const child = spawn(command, [...args], { stdio: 'ignore', argv0 })
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
    const value = await probe()
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

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const child of children.splice(0)) {
    if (childAlive(child)) {
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
    }
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe.runIf(process.platform === 'darwin' || process.platform === 'linux')(
  'real-OS process observation',
  () => {
    it('an unavailable observation tool fails closed while the process stays alive', async () => {
      const child = spawnTracked(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
      await once(child, 'spawn')
      vi.stubEnv('PATH', await makeTempDir())
      await expect(observeProcess(child.pid!)).rejects.toThrow(
        `cannot observe companion-port holder pid ${child.pid}`,
      )
      expect(childAlive(child)).toBe(true)
    })

    it('an unavailable listener tool fails closed instead of reporting a free port', async () => {
      vi.stubEnv('PATH', await makeTempDir())
      await expect(observePortListeners(9999)).rejects.toThrow('lsof observation failed')
    })

    // Darwin lsof reports region-observation failures in NAME fields, even after valid mappings.
    it.runIf(process.platform === 'darwin')(
      'a partial lsof mapping observation fails closed',
      async () => {
        const child = spawnTracked(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
        await once(child, 'spawn')
        const dir = await makeTempDir()
        await writeFile(
          path.join(dir, 'lsof'),
          `#!/bin/sh\nprintf 'p${child.pid}\\0ftxt\\0n/usr/lib/dyld\\0\\nftxt\\0nregion info error: Permission denied\\0\\n'\n`,
          { mode: 0o755 },
        )
        vi.stubEnv('PATH', `${dir}:${process.env.PATH}`)
        await expect(observeProcess(child.pid!)).rejects.toThrow('incomplete executable mappings')
        expect(childAlive(child)).toBe(true)
      },
    )

    it('a confirmed exited process is omitted from observation', async () => {
      const child = spawnTracked(process.execPath, ['-e', ''])
      await once(child, 'exit')
      await expect(observeProcess(child.pid!)).resolves.toBeUndefined()
    })

    it('observes a copied executable at the simulator runner path with spaces and claims it', async () => {
      // Copying a real executable proves the mapped path; a symlink only changes its invocation.
      const dir = await makeTempDir()
      const runnerPath = path.join(
        dir,
        'Home With Space/Library/Developer/CoreSimulator/Devices',
        SIM,
        'data/Containers/Bundle/Application/1F',
        `${RUNNER}.app/${RUNNER}`,
      )
      await mkdir(path.dirname(runnerPath), { recursive: true })
      await copyFile('/bin/sleep', runnerPath)
      const child = spawnTracked(runnerPath, ['30'])

      const observed = await waitFor(() => observeProcess(child.pid!), 'process observation')
      expect(observed?.pid).toBe(child.pid)
      expect(observed?.executablePaths).toContain(await realpath(runnerPath))
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

    it('a symlink named like the simulator runner does not change the executable mapping', async () => {
      const dir = await makeTempDir()
      const runnerPath = path.join(dir, 'CoreSimulator/Devices', SIM, `${RUNNER}.app/${RUNNER}`)
      await mkdir(path.dirname(runnerPath), { recursive: true })
      await symlink('/bin/sleep', runnerPath)
      const child = spawnTracked(runnerPath, ['30'])
      const observed = await waitFor(() => observeProcess(child.pid!), 'symlinked executable')
      expect(observed.executablePaths).toContain(await realpath('/bin/sleep'))
      expect(observed.executablePaths).not.toContain(runnerPath)
      const spec: FreePortSpec = {
        port: 9999,
        owner: { platform: 'ios', kind: 'simulator', simUdid: SIM, runnerExecutable: RUNNER },
        freeUnowned: false,
      }
      expect(classifyPortHolders(spec, { listeners: [observed], forwards: [] }).killPids).toEqual(
        [],
      )
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

    it('a real Node listener with a spoofed simulator-runner argv0 remains foreign', async () => {
      const port = await freePortNumber()
      // This path does not exist: only argv[0] claims the selected simulator's runner identity.
      const argv0 = `/not/a/real/CoreSimulator/Devices/${SIM}/data/Containers/Bundle/Application/1F/${RUNNER}.app/${RUNNER}`
      const child = spawnTracked(
        process.execPath,
        ['-e', `require('node:net').createServer().listen(${port}, '127.0.0.1')`],
        argv0,
      )
      const observed = await waitFor(async () => {
        const listeners = await observePortListeners(port)
        return listeners.find((listener) => listener.pid === child.pid)
      }, `spoofed listener on port ${port}`)
      expect(observed.args.startsWith(argv0)).toBe(true)
      expect(observed.executablePaths).toContain(await realpath(process.execPath))
      expect(observed.executablePaths).not.toContain(argv0)
      const spec: FreePortSpec = {
        port,
        owner: { platform: 'ios', kind: 'simulator', simUdid: SIM, runnerExecutable: RUNNER },
        freeUnowned: false,
      }
      const plan = classifyPortHolders(spec, { listeners: [observed], forwards: [] })
      expect(plan.killPids).toEqual([])
      expect(plan.foreign).toEqual([{ kind: 'process', pid: child.pid, args: observed.args }])
      await expect(new NodeProcessRunner().freePort(spec)).rejects.toBeInstanceOf(
        PortOwnershipError,
      )
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

    it('recognizes a real python entry-point forward using interpreter mapping and script argv', async () => {
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

      // The mapping is the interpreter; the full argv retains the script entry point.
      expect(path.basename(observed.args.split(' ')[1] ?? '')).toBe('pymobiledevice3')

      const spec: FreePortSpec = {
        port,
        owner: { platform: 'ios', kind: 'device', serial: DEVICE_UDID },
        freeUnowned: false,
      }
      const plan = classifyPortHolders(spec, { listeners: [observed], forwards: [] })
      expect(plan.killPids).toEqual([child.pid])
      expect(plan.foreign).toEqual([])
    })

    it('a REAL python -c process whose code mentions the UDID stays foreign', async () => {
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
    })
  },
)
