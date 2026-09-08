import { describe, expect, it } from 'vitest'
import type { FreePortSpec } from '../plan/types'
import type { PortListener } from './port-ownership'
import { classifyPortHolders, parseAdbForwardList, PortOwnershipError } from './port-ownership'

const SIM = '0089EDC0-38EB-47D7-8E68-DB4CB80BAD99'
const OTHER_SIM = '42F9A94A-83BE-4262-A69E-5A93670D3A6F'
const PARTIAL_SIM = '0089EDC0-38EB'
const DEVICE_UDID = '00008101-001C0A0C3C00001E'
const OTHER_DEVICE_UDID = '00008101-001C0A0C3C00002F'
const RUNNER = 'exampleUITests-Runner'
const OTHER_RUNNER = 'SendPreviewUITests-Runner'
const PORT = 9973

/** The real XCTest-runner path shape, from an actual crashed companion. */
const runnerPath = (udid: string, appUuid: string, name: string): string =>
  `/Users/me/Library/Developer/CoreSimulator/Devices/${udid}/data/Containers/Bundle/Application/${appUuid}/${name}.app/${name}`

const simRunnerListener = (
  pid: number,
  udid: string,
  name: string,
  appUuid = '1F',
): PortListener => {
  const executable = runnerPath(udid, appUuid, name)
  return { pid, executablePaths: [executable], args: executable }
}

const iosSimSpec = (freeUnowned = false): FreePortSpec => ({
  port: PORT,
  owner: { platform: 'ios', kind: 'simulator', simUdid: SIM, runnerExecutable: RUNNER },
  freeUnowned,
})
const iosDeviceSpec = (freeUnowned = false): FreePortSpec => ({
  port: PORT,
  owner: { platform: 'ios', kind: 'device', serial: DEVICE_UDID },
  freeUnowned,
})
const androidSpec = (freeUnowned = false): FreePortSpec => ({
  port: PORT,
  owner: { platform: 'android', serial: 'emulator-5580' },
  freeUnowned,
})

const adbServer = {
  pid: 9001,
  executablePaths: ['/opt/android/platform-tools/adb'],
  args: 'adb -L tcp:5037 fork-server server --reply-fd 4',
}
const otherSimRunner = simRunnerListener(777, OTHER_SIM, OTHER_RUNNER, '2A')

/** Representative python interpreter path, observed on macOS (may be a framework binary). */
const PY =
  '/opt/homebrew/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/Resources/Python.app/Contents/MacOS/Python'

const forwardListener = (pid: number, args: string, executable: string): PortListener => ({
  pid,
  executablePaths: [executable],
  args,
})

describe('classifyPortHolders (REQ-OWN-003)', () => {
  describe('iOS simulator: the observed EXECUTABLE must be the configured runner inside the selected simulator (device-path component + matching app/executable basename)', () => {
    const ownSimRunner = simRunnerListener(501, SIM, RUNNER)

    it('kills a listener whose executable is the configured runner on the selected simulator', () => {
      const plan = classifyPortHolders(iosSimSpec(), { listeners: [ownSimRunner], forwards: [] })
      expect(plan).toEqual({ killPids: [501], removeForwardSerials: [], foreign: [] })
    })

    it('does not depend on the order of executable and library mappings', () => {
      const executable = runnerPath(SIM, '1F', RUNNER)
      for (const executablePaths of [
        ['/usr/lib/dyld', executable],
        [executable, '/usr/lib/dyld'],
      ]) {
        const plan = classifyPortHolders(iosSimSpec(), {
          listeners: [{ pid: 503, executablePaths, args: executable }],
          forwards: [],
        })
        expect(plan).toEqual({ killPids: [503], removeForwardSerials: [], foreign: [] })
      }
    })

    it('missing executable mappings cannot be replaced by a recognized argv0', () => {
      const listener = { pid: 504, executablePaths: [], args: runnerPath(SIM, '1F', RUNNER) }
      const plan = classifyPortHolders(iosSimSpec(), { listeners: [listener], forwards: [] })
      expect(plan.killPids).toEqual([])
      expect(plan.foreign).toEqual([{ kind: 'process', pid: 504, args: listener.args }])
    })

    it('supports a home-directory path with spaces (executable is a single observed field, not re-tokenized)', () => {
      const executable = runnerPath(SIM, '1F', RUNNER).replace(
        '/Users/me/',
        '/Users/me With Space/',
      )
      const plan = classifyPortHolders(iosSimSpec(), {
        listeners: [{ pid: 502, executablePaths: [executable], args: executable }],
        forwards: [],
      })
      expect(plan.killPids).toEqual([502])
      expect(plan.foreign).toEqual([])
    })

    const SIM_RUNNER_SHAPES: ReadonlyArray<{
      readonly name: string
      readonly listener: PortListener
      readonly owned: boolean
    }> = [
      {
        name: 'the configured runner on ANOTHER simulator',
        listener: otherSimRunner,
        owned: false,
      },
      {
        name: 'an unrelated app on the SAME simulator',
        listener: (() => {
          const executable = runnerPath(SIM, '9C', 'OtherApp')
          return { pid: 778, executablePaths: [executable], args: executable }
        })(),
        owned: false,
      },
      {
        name: 'a DIFFERENT UI-test scheme runner on the same simulator',
        listener: simRunnerListener(779, SIM, OTHER_RUNNER),
        owned: false,
      },
      {
        name: 'an executable name with the runner name as a mere prefix',
        listener: (() => {
          const executable = `${runnerPath(SIM, '1F', RUNNER)}X`
          return { pid: 780, executablePaths: [executable], args: executable }
        })(),
        owned: false,
      },
      {
        name: 'a partial simulator UDID path component',
        listener: (() => {
          const executable = runnerPath(PARTIAL_SIM, '1F', RUNNER)
          return { pid: 781, executablePaths: [executable], args: executable }
        })(),
        owned: false,
      },
      {
        name: 'the bare executable name without any device path',
        listener: { pid: 782, executablePaths: [RUNNER], args: RUNNER },
        owned: false,
      },
      {
        name: 'args that merely MENTION the runner path while executable is an unrelated executable',
        listener: {
          pid: 783,
          executablePaths: ['/usr/bin/nice'],
          args: `nice ${runnerPath(SIM, '1F', RUNNER)}`,
        },
        owned: false,
      },
      {
        name: 'a runner path with a Devices component but no CoreSimulator pair',
        listener: (() => {
          const executable = `/mnt/shared/Devices/${SIM}/data/Containers/Bundle/Application/1F/${RUNNER}.app/${RUNNER}`
          return { pid: 784, executablePaths: [executable], args: executable }
        })(),
        owned: false,
      },
    ]

    it.each(SIM_RUNNER_SHAPES.map((s) => [s.name, s] as const))(
      'iOS simulator: %s is foreign — nothing is killed',
      (_name, shape) => {
        const plan = classifyPortHolders(iosSimSpec(), {
          listeners: [shape.listener],
          forwards: [],
        })
        expect(plan.killPids).toEqual([])
        expect(plan.removeForwardSerials).toEqual([])
        expect(plan.foreign).toEqual([
          { kind: 'process', pid: shape.listener.pid, args: shape.listener.args },
        ])
      },
    )
  })

  describe('iOS physical device: recognize the emitted pymobiledevice3 usbmux forward command by shape, exact --serial, and port arguments', () => {
    const FORWARD_SHAPES: ReadonlyArray<{
      readonly name: string
      readonly args: string
      readonly executable: string
      readonly owned: boolean
    }> = [
      // Owned: the exact command this runner emits (cmd('pymobiledevice3', …)), argv[0] as typed.
      {
        name: 'direct script, argv[0] as typed',
        args: `pymobiledevice3 usbmux forward --serial ${DEVICE_UDID} ${PORT} ${PORT}`,
        executable: 'pymobiledevice3',
        owned: true,
      },
      // Owned: PATH-resolved argv[0] (a real binary would report this executable).
      {
        name: 'direct script, resolved path',
        args: `/usr/local/bin/pymobiledevice3 usbmux forward --serial ${DEVICE_UDID} ${PORT} ${PORT}`,
        executable: '/usr/local/bin/pymobiledevice3',
        owned: true,
      },
      // Owned: the shape macOS actually reports for a shebang script — the kernel records the
      // interpreter as the executable and the resolved script as argv[1].
      {
        name: 'python script entry point (interpreter + script path)',
        args: `${PY} /usr/local/bin/pymobiledevice3 usbmux forward --serial ${DEVICE_UDID} ${PORT} ${PORT}`,
        executable: PY,
        owned: true,
      },
      // Owned: module invocation.
      {
        name: 'python -m pymobiledevice3',
        args: `${PY} -m pymobiledevice3 usbmux forward --serial ${DEVICE_UDID} ${PORT} ${PORT}`,
        executable: PY,
        owned: true,
      },
      // Foreign: arbitrary processes that merely mention the UDID/port.
      {
        name: 'a node process whose args carry the UDID and ports',
        args: `node /lanes/other/tools/forward.js usbmux forward --serial ${DEVICE_UDID} ${PORT} ${PORT}`,
        executable: 'node',
        owned: false,
      },
      {
        name: 'python -c whose code string mentions the command',
        args: `${PY} -c import os; os.system("pymobiledevice3 usbmux forward --serial ${DEVICE_UDID} ${PORT} ${PORT}")`,
        executable: PY,
        owned: false,
      },
      {
        name: 'a python module that is NOT pymobiledevice3',
        args: `${PY} -m other.tool usbmux forward --serial ${DEVICE_UDID} ${PORT} ${PORT}`,
        executable: PY,
        owned: false,
      },
      {
        name: 'an unrelated script name next to a python interpreter',
        args: `${PY} /usr/local/bin/not-pymobiledevice3 usbmux forward --serial ${DEVICE_UDID} ${PORT} ${PORT}`,
        executable: PY,
        owned: false,
      },
      // Foreign: right shape, wrong identity.
      {
        name: 'a PARTIAL hardware UDID as --serial value',
        args: `pymobiledevice3 usbmux forward --serial 00008101-001C ${PORT} ${PORT}`,
        executable: 'pymobiledevice3',
        owned: false,
      },
      {
        name: 'a DIFFERENT device --serial',
        args: `pymobiledevice3 usbmux forward --serial ${OTHER_DEVICE_UDID} ${PORT} ${PORT}`,
        executable: 'pymobiledevice3',
        owned: false,
      },
      {
        name: 'a different LOCAL port argument',
        args: `pymobiledevice3 usbmux forward --serial ${DEVICE_UDID} ${PORT + 1} ${PORT}`,
        executable: 'pymobiledevice3',
        owned: false,
      },
      {
        name: 'no --serial at all',
        args: `pymobiledevice3 usbmux forward ${PORT} ${PORT}`,
        executable: 'pymobiledevice3',
        owned: false,
      },
      // Foreign: ambiguous / unrecognized command shapes fail closed.
      {
        name: 'an unrecognized extra option',
        args: `pymobiledevice3 usbmux forward --serial ${DEVICE_UDID} --daemonize ${PORT} ${PORT}`,
        executable: 'pymobiledevice3',
        owned: false,
      },
      {
        name: 'the --serial=value form (this runner never emits it)',
        args: `pymobiledevice3 usbmux forward --serial=${DEVICE_UDID} ${PORT} ${PORT}`,
        executable: 'pymobiledevice3',
        owned: false,
      },
      {
        name: 'a non-numeric port argument',
        args: `pymobiledevice3 usbmux forward --serial ${DEVICE_UDID} ${PORT} usb:${PORT}`,
        executable: 'pymobiledevice3',
        owned: false,
      },
      {
        name: 'a missing remote port argument',
        args: `pymobiledevice3 usbmux forward --serial ${DEVICE_UDID} ${PORT}`,
        executable: 'pymobiledevice3',
        owned: false,
      },
      {
        name: 'a non-python, non-pymobiledevice3 executable',
        args: `pymobiledevice3 usbmux forward --serial ${DEVICE_UDID} ${PORT} ${PORT}`,
        executable: '/usr/bin/env',
        owned: false,
      },
    ]

    it.each(FORWARD_SHAPES.map((s) => [s.name, s] as const))('iOS device: %s', (_name, shape) => {
      const listener = forwardListener(610, shape.args, shape.executable)
      const plan = classifyPortHolders(iosDeviceSpec(), { listeners: [listener], forwards: [] })
      if (shape.owned) {
        expect(plan).toEqual({ killPids: [610], removeForwardSerials: [], foreign: [] })
      } else {
        expect(plan.killPids).toEqual([])
        expect(plan.removeForwardSerials).toEqual([])
        expect(plan.foreign).toEqual([{ kind: 'process', pid: 610, args: shape.args }])
      }
    })

    it('freeUnowned reclaims an unrecognized forward holder', () => {
      const listener = forwardListener(
        611,
        `node /lanes/other/tools/forward.js --serial ${DEVICE_UDID} ${PORT} ${PORT}`,
        'node',
      )
      const plan = classifyPortHolders(iosDeviceSpec(true), { listeners: [listener], forwards: [] })
      expect(plan).toEqual({ killPids: [611], removeForwardSerials: [], foreign: [] })
    })
  })

  it('iOS: an adb forward on the port belongs to an Android lane — foreign by serial, the adb server is never a kill target', () => {
    const plan = classifyPortHolders(iosSimSpec(), {
      listeners: [adbServer],
      forwards: [{ serial: 'emulator-5554', local: `tcp:${PORT}`, remote: `tcp:${PORT}` }],
    })
    expect(plan.killPids).toEqual([])
    expect(plan.foreign).toEqual([{ kind: 'forward', serial: 'emulator-5554' }])
  })

  it('Android: removes the forward registered for the selected serial only', () => {
    const plan = classifyPortHolders(androidSpec(), {
      listeners: [adbServer],
      forwards: [
        { serial: 'emulator-5580', local: `tcp:${PORT}`, remote: `tcp:${PORT}` },
        { serial: 'emulator-5554', local: `tcp:${PORT}`, remote: `tcp:${PORT}` },
      ],
    })
    expect(plan.removeForwardSerials).toEqual(['emulator-5580'])
    expect(plan.killPids).toEqual([])
    expect(plan.foreign).toEqual([{ kind: 'forward', serial: 'emulator-5554' }])
  })

  it("Android: a non-adb listener (another lane's iOS companion) is a foreign process", () => {
    const plan = classifyPortHolders(androidSpec(), {
      listeners: [otherSimRunner],
      forwards: [],
    })
    expect(plan.foreign).toEqual([{ kind: 'process', pid: 777, args: otherSimRunner.args }])
  })

  it('Android: an iOS-shaped forward command is a foreign process, never claimed by serial matching', () => {
    const plan = classifyPortHolders(androidSpec(), {
      listeners: [
        forwardListener(
          612,
          `pymobiledevice3 usbmux forward --serial ${DEVICE_UDID} ${PORT} ${PORT}`,
          'pymobiledevice3',
        ),
      ],
      forwards: [],
    })
    expect(plan.killPids).toEqual([])
    expect(plan.foreign).toHaveLength(1)
  })

  it('freeUnowned restores the unconditional free: every holder is killed or removed, nothing is foreign', () => {
    const plan = classifyPortHolders(androidSpec(true), {
      listeners: [adbServer, otherSimRunner],
      forwards: [{ serial: 'emulator-5554', local: `tcp:${PORT}`, remote: `tcp:${PORT}` }],
    })
    expect(plan).toEqual({
      killPids: [777],
      removeForwardSerials: ['emulator-5554'],
      foreign: [],
    })
  })

  it('a free port is a no-op plan', () => {
    expect(classifyPortHolders(iosSimSpec(), { listeners: [], forwards: [] })).toEqual({
      killPids: [],
      removeForwardSerials: [],
      foreign: [],
    })
  })
})

describe('parseAdbForwardList', () => {
  it('keeps only rows whose local end is the companion port', () => {
    const stdout = [
      'emulator-5554 tcp:9973 tcp:9973',
      'emulator-5580 tcp:9974 tcp:9974',
      'R58M123ABC tcp:9973 tcp:9999',
      '',
    ].join('\n')
    expect(parseAdbForwardList(stdout, 9973)).toEqual([
      { serial: 'emulator-5554', local: 'tcp:9973', remote: 'tcp:9973' },
      { serial: 'R58M123ABC', local: 'tcp:9973', remote: 'tcp:9999' },
    ])
  })

  it('parses an empty list', () => {
    expect(parseAdbForwardList('', 9973)).toEqual([])
  })
})

describe('PortOwnershipError', () => {
  it('names the port, every foreign holder, and the opt-in key without killing anything', () => {
    const error = new PortOwnershipError(iosSimSpec(), [
      { kind: 'process', pid: 777, args: otherSimRunner.args },
      { kind: 'forward', serial: 'emulator-5554' },
    ])
    expect(error.message).toContain(`companion port ${PORT}`)
    expect(error.message).toContain(`pid 777`)
    expect(error.message).toContain(OTHER_SIM)
    expect(error.message).toContain('adb forward for emulator-5554')
    expect(error.message).toContain('ios.companion.freeUnownedPort')
    expect(error.message).not.toContain(SIM)
  })
})
