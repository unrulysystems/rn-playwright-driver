import { describe, expect, it, vi } from 'vitest'
import type { TouchBackendContext } from './backend'
import {
  TouchBackendCommandError,
  TouchBackendUnavailableError,
  type TouchBackendName,
} from './backend'
import { type AdbExec, CliTouchBackend } from './cli-backend'

function createContext(density = 1): {
  context: TouchBackendContext
  evaluate: ReturnType<typeof vi.fn>
} {
  const evaluate = vi.fn((_expression: string) => density)
  return {
    context: {
      platform: 'android',
      evaluate: async <T>(expression: string): Promise<T> => evaluate(expression) as T,
      waitForTimeout: vi.fn(),
    },
    evaluate,
  }
}

function createExec(
  handler: (args: string[]) => Promise<{ stdout: string; stderr: string; code: number }> = async (
    args,
  ) => {
    if (args.at(-1) === 'ro.build.version.sdk') {
      return { stdout: '30\n', stderr: '', code: 0 }
    }
    return { stdout: 'device\n', stderr: '', code: 0 }
  },
): { exec: AdbExec; calls: string[][] } {
  const calls: string[][] = []
  const exec: AdbExec = async (args) => {
    calls.push(args)
    return handler(args)
  }
  return { exec, calls }
}

function createBackend(options: {
  density?: number
  serial?: string
  adbPath?: string
  exec?: AdbExec
}): {
  backend: CliTouchBackend
  calls: string[][]
  evaluate: ReturnType<typeof vi.fn>
} {
  const { context, evaluate } = createContext(options.density ?? 1)
  const fakeExec = options.exec === undefined ? createExec() : undefined
  const exec = options.exec ?? fakeExec?.exec
  const config = {
    ...(options.adbPath === undefined ? {} : { adbPath: options.adbPath }),
    ...(options.serial === undefined ? {} : { serial: options.serial }),
  }
  if (exec === undefined) {
    throw new Error('expected fake exec to be constructed')
  }
  return {
    backend: new CliTouchBackend(context, config, { exec }),
    calls: fakeExec?.calls ?? [],
    evaluate,
  }
}

describe('CliTouchBackend', () => {
  it('probes adb state during initialization and includes the configured serial', async () => {
    const { exec, calls } = createExec()
    const { context } = createContext()
    const backend = new CliTouchBackend(context, { serial: 'emulator-5554' }, { exec })

    await backend.init()

    expect(calls).toEqual([['-s', 'emulator-5554', 'get-state']])
  })

  it('throws unavailable when adb get-state is not a device', async () => {
    const cases: Array<{
      name: string
      exec: AdbExec
      message: string
    }> = [
      {
        name: 'non-device stdout',
        exec: async () => ({ stdout: 'offline\n', stderr: '', code: 0 }),
        message: 'offline',
      },
      {
        name: 'non-zero exit',
        exec: async () => ({ stdout: '', stderr: 'no devices', code: 1 }),
        message: 'no devices',
      },
      {
        name: 'throwing exec',
        exec: async () => {
          throw new Error('adb missing')
        },
        message: 'adb missing',
      },
    ]

    await Promise.all(
      cases.map(async (entry) => {
        const { context } = createContext()
        const backend = new CliTouchBackend(
          context,
          { adbPath: '/opt/android/adb', serial: 'emulator-5554' },
          { exec: entry.exec },
        )

        await expect(backend.init(), entry.name).rejects.toMatchObject({
          backend: 'cli' satisfies TouchBackendName,
          message: expect.stringContaining('/opt/android/adb'),
          name: 'TouchBackendUnavailableError',
        })
        await expect(backend.init(), entry.name).rejects.toMatchObject({
          message: expect.stringContaining('emulator-5554'),
        })
        await expect(backend.init(), entry.name).rejects.toMatchObject({
          message: expect.stringContaining(entry.message),
        })
      }),
    )
  })

  it('converts dp to px for taps and caches density across commands', async () => {
    const { backend, calls, evaluate } = createBackend({
      density: 3,
      serial: 'emulator-5554',
      adbPath: '/opt/android/adb',
    })

    await backend.init()
    await backend.tap(10, 20)
    await backend.tap(11, 21)

    expect(calls).toEqual([
      ['-s', 'emulator-5554', 'get-state'],
      ['-s', 'emulator-5554', 'shell', 'input', 'tap', '30', '60'],
      ['-s', 'emulator-5554', 'shell', 'input', 'tap', '33', '63'],
    ])
    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(evaluate).toHaveBeenCalledWith("require('react-native').PixelRatio.get()")
  })

  it('emits exact swipe and longPress argv with converted coordinates', async () => {
    const { backend, calls } = createBackend({ density: 2, serial: 'emulator-5554' })

    await backend.swipe({ x: 1, y: 2 }, { x: 3, y: 4 }, 250)
    await backend.longPress(5, 6, {})
    await backend.longPress(7, 8, { duration: 750 })

    expect(calls).toEqual([
      ['-s', 'emulator-5554', 'shell', 'input', 'swipe', '2', '4', '6', '8', '250'],
      ['-s', 'emulator-5554', 'shell', 'input', 'swipe', '10', '12', '10', '12', '500'],
      ['-s', 'emulator-5554', 'shell', 'input', 'swipe', '14', '16', '14', '16', '750'],
    ])
  })

  it('escapes spaces for adb input text', async () => {
    const { backend, calls } = createBackend({ adbPath: '/custom/adb', serial: 'device-1' })

    await backend.typeText('a b')

    expect(calls).toEqual([['-s', 'device-1', 'shell', 'input', 'text', 'a%sb']])
  })

  it('emits motion events on API 30 and later, with up using the last position', async () => {
    const { backend, calls } = createBackend({ density: 3, serial: 'emulator-5554' })

    await backend.down(1, 2)
    await backend.move(3, 4)
    await backend.up()

    expect(calls).toEqual([
      ['-s', 'emulator-5554', 'shell', 'getprop', 'ro.build.version.sdk'],
      ['-s', 'emulator-5554', 'shell', 'input', 'motionevent', 'DOWN', '3', '6'],
      ['-s', 'emulator-5554', 'shell', 'input', 'motionevent', 'MOVE', '9', '12'],
      ['-s', 'emulator-5554', 'shell', 'input', 'motionevent', 'UP', '9', '12'],
    ])
  })

  it('throws NOT_SUPPORTED for streaming gestures before API 30', async () => {
    const { exec, calls } = createExec(async (args) => {
      if (args.at(-1) === 'ro.build.version.sdk') {
        return { stdout: '29\n', stderr: '', code: 0 }
      }
      return { stdout: 'device\n', stderr: '', code: 0 }
    })
    const { context } = createContext()
    const backend = new CliTouchBackend(context, { serial: 'emulator-5554' }, { exec })

    await expect(backend.down(1, 2)).rejects.toMatchObject({
      backend: 'cli',
      code: 'NOT_SUPPORTED',
      message: expect.stringContaining('instrumentation companion'),
      name: 'TouchBackendCommandError',
    })
    await expect(backend.down(1, 2)).rejects.toThrow(TouchBackendCommandError)
    expect(calls).toEqual([['-s', 'emulator-5554', 'shell', 'getprop', 'ro.build.version.sdk']])
  })

  it('maps non-zero adb command exits to command errors', async () => {
    const { context } = createContext(2)
    const backend = new CliTouchBackend(context, undefined, {
      exec: async () => ({ stdout: '', stderr: 'tap failed', code: 1 }),
    })

    await expect(backend.tap(1, 2)).rejects.toThrow(TouchBackendCommandError)
    await expect(backend.tap(1, 2)).rejects.toMatchObject({
      backend: 'cli',
      message: 'tap failed',
      name: 'TouchBackendCommandError',
    })
  })

  it('throws unavailable errors from init with the expected type', async () => {
    const { context } = createContext()
    const backend = new CliTouchBackend(context, undefined, {
      exec: async () => ({ stdout: 'unauthorized\n', stderr: '', code: 0 }),
    })

    await expect(backend.init()).rejects.toThrow(TouchBackendUnavailableError)
  })
})
