import { describe, expect, it } from 'vitest'
import { RNDevice } from '../device'
import { FileIoError } from './errors'

describe('RNDevice.files wiring', () => {
  it('exposes a files getter that throws UNAVAILABLE before connect()', () => {
    const device = new RNDevice({})
    try {
      // Accessing the getter (not calling a method) must fail closed pre-connect.
      void device.files
      expect.unreachable('device.files should throw before connect()')
    } catch (error) {
      expect(error).toBeInstanceOf(FileIoError)
      expect((error as FileIoError).code).toBe('UNAVAILABLE')
    }
  })
})
