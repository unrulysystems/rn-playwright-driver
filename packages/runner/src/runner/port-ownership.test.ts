import { describe, expect, it } from 'vitest'
import type { FreePortSpec } from '../plan/types'
import { classifyPortHolders, parseAdbForwardList, PortOwnershipError } from './port-ownership'

const SIM = '0089EDC0-38EB-47D7-8E68-DB4CB80BAD99'
const OTHER_SIM = '42F9A94A-83BE-4262-A69E-5A93670D3A6F'
const ownSimRunner = {
  pid: 501,
  args: `/Users/me/Library/Developer/CoreSimulator/Devices/${SIM}/data/Containers/Bundle/Application/1F/exampleUITests-Runner.app/exampleUITests-Runner`,
}
const otherSimRunner = {
  pid: 777,
  args: `/Users/me/Library/Developer/CoreSimulator/Devices/${OTHER_SIM}/data/Containers/Bundle/Application/2A/SendPreviewUITests-Runner.app/SendPreviewUITests-Runner`,
}
const adbServer = { pid: 9001, args: 'adb -L tcp:5037 fork-server server --reply-fd 4' }

const iosSpec = (freeUnowned = false): FreePortSpec => ({
  port: 9973,
  owner: { platform: 'ios', targetId: SIM },
  freeUnowned,
})
const androidSpec = (freeUnowned = false): FreePortSpec => ({
  port: 9973,
  owner: { platform: 'android', serial: 'emulator-5580' },
  freeUnowned,
})

describe('classifyPortHolders (REQ-OWN-003)', () => {
  it('iOS: kills a listener hosted by the selected simulator and reports nothing foreign', () => {
    const plan = classifyPortHolders(iosSpec(), { listeners: [ownSimRunner], forwards: [] })
    expect(plan).toEqual({ killPids: [501], removeForwardSerials: [], foreign: [] })
  })

  it('iOS: a listener hosted by ANOTHER simulator is foreign — nothing is killed', () => {
    const plan = classifyPortHolders(iosSpec(), {
      listeners: [otherSimRunner],
      forwards: [],
    })
    expect(plan.killPids).toEqual([])
    expect(plan.foreign).toEqual([{ kind: 'process', pid: 777, args: otherSimRunner.args }])
  })

  it('iOS: an adb forward on the port belongs to an Android lane — foreign by serial, the adb server is never a kill target', () => {
    const plan = classifyPortHolders(iosSpec(), {
      listeners: [adbServer],
      forwards: [{ serial: 'emulator-5554', local: 'tcp:9973', remote: 'tcp:9973' }],
    })
    expect(plan.killPids).toEqual([])
    expect(plan.foreign).toEqual([{ kind: 'forward', serial: 'emulator-5554' }])
  })

  it('Android: removes the forward registered for the selected serial only', () => {
    const plan = classifyPortHolders(androidSpec(), {
      listeners: [adbServer],
      forwards: [
        { serial: 'emulator-5580', local: 'tcp:9973', remote: 'tcp:9973' },
        { serial: 'emulator-5554', local: 'tcp:9973', remote: 'tcp:9973' },
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

  it('freeUnowned restores the unconditional free: every holder is killed or removed, nothing is foreign', () => {
    const plan = classifyPortHolders(androidSpec(true), {
      listeners: [adbServer, otherSimRunner],
      forwards: [{ serial: 'emulator-5554', local: 'tcp:9973', remote: 'tcp:9973' }],
    })
    expect(plan).toEqual({
      killPids: [777],
      removeForwardSerials: ['emulator-5554'],
      foreign: [],
    })
  })

  it('a free port is a no-op plan', () => {
    expect(classifyPortHolders(iosSpec(), { listeners: [], forwards: [] })).toEqual({
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
    const error = new PortOwnershipError(iosSpec(), [
      { kind: 'process', pid: 777, args: otherSimRunner.args },
      { kind: 'forward', serial: 'emulator-5554' },
    ])
    expect(error.message).toContain('companion port 9973')
    expect(error.message).toContain(`pid 777`)
    expect(error.message).toContain(OTHER_SIM)
    expect(error.message).toContain('adb forward for emulator-5554')
    expect(error.message).toContain('ios.companion.freeUnownedPort')
    expect(error.message).not.toContain(SIM)
  })
})
