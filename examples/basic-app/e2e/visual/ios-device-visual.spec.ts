import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { expect, expectLocator, test } from '@unrulysystems/rn-playwright-driver/test'

type NativeResult<T> = { success: true; data: T } | { success: false; error: string; code?: string }

type ElementInfo = {
  handle: string
  testId?: string | null
  text?: string | null
  bounds: { x: number; y: number; width: number; height: number }
  visible: boolean
  enabled: boolean
}

type VisualState = {
  title: NativeResult<ElementInfo>
  countDisplay: NativeResult<ElementInfo>
  incrementButton: NativeResult<ElementInfo>
  dragStatus: NativeResult<ElementInfo>
  platform: string
  iosTargetKind?: string
}

type VisualCapture = {
  id: string
  description: string
  expectation: string
  testFile: string
  testTitle: string
  api: 'device.screenshot'
  screenshot: string
  state: string
  pngSha256: string
  pngSize: { width: number; height: number }
  windowMetrics: {
    width: number
    height: number
    scale: number
    pixelRatio: number
    fontScale: number
    orientation: 'portrait' | 'landscape'
  }
  passCriteria: string[]
  failCriteria: string[]
}

const ARTIFACT_DIR = join(process.cwd(), 'test-results', 'visual-judge', 'latest')
const MANIFEST_PATH = join(ARTIFACT_DIR, 'manifest.json')

async function requireScreenshotAndViewTree(device: {
  evaluate<T>(expression: string): Promise<T>
}): Promise<boolean> {
  const capabilities = await device.evaluate<{ screenshot: boolean; viewTree: boolean }>(
    'globalThis.__RN_DRIVER__.capabilities',
  )

  if (!capabilities.screenshot || !capabilities.viewTree) {
    test.skip()
    return false
  }

  return true
}

async function getCount(device: { evaluate<T>(expression: string): Promise<T> }): Promise<number> {
  const text = await device.evaluate<string>(
    "globalThis.__RN_DRIVER__.viewTree.findByTestId('count-display').then(r => r.success ? r.data.text : 'Count: 0')",
  )
  const match = /\d+/.exec(text)
  return match ? Number.parseInt(match[0], 10) : 0
}

async function readVisualState(device: {
  evaluate<T>(expression: string): Promise<T>
  platform: 'ios' | 'android'
}): Promise<VisualState> {
  return {
    title: await device.evaluate<NativeResult<ElementInfo>>(
      "globalThis.__RN_DRIVER__.viewTree.findByTestId('title')",
    ),
    countDisplay: await device.evaluate<NativeResult<ElementInfo>>(
      "globalThis.__RN_DRIVER__.viewTree.findByTestId('count-display')",
    ),
    incrementButton: await device.evaluate<NativeResult<ElementInfo>>(
      "globalThis.__RN_DRIVER__.viewTree.findByTestId('increment-button')",
    ),
    dragStatus: await device.evaluate<NativeResult<ElementInfo>>(
      "globalThis.__RN_DRIVER__.viewTree.findByTestId('drag-status')",
    ),
    platform: device.platform,
    iosTargetKind: process.env.RN_IOS_TARGET_KIND,
  }
}

async function captureVisual(
  device: Parameters<typeof readVisualState>[0] & {
    getWindowMetrics(): Promise<VisualCapture['windowMetrics']>
    screenshot(): Promise<Buffer>
  },
  id: string,
  description: string,
  expectation: string,
  testInfo: {
    attach: (name: string, options: { path: string; contentType: string }) => Promise<void>
  },
): Promise<VisualCapture> {
  const screenshot = await device.screenshot()
  const screenshotPath = join(ARTIFACT_DIR, `${id}.png`)
  const statePath = join(ARTIFACT_DIR, `${id}.state.json`)
  const state = await readVisualState(device)
  const pngSize = readPngSize(screenshot)
  const windowMetrics = await device.getWindowMetrics()

  await writeFile(screenshotPath, screenshot)
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`)
  await testInfo.attach(id, { path: screenshotPath, contentType: 'image/png' })

  return {
    id,
    description,
    expectation,
    testFile: 'e2e/visual/ios-device-visual.spec.ts',
    testTitle:
      'Physical iOS visual judge artifacts > captures final-screen evidence for blind judging',
    api: 'device.screenshot',
    screenshot: relative(ARTIFACT_DIR, screenshotPath),
    state: relative(ARTIFACT_DIR, statePath),
    pngSha256: createHash('sha256').update(screenshot).digest('hex'),
    pngSize,
    windowMetrics,
    passCriteria: [
      'The expected React Native counter example screen is visible.',
      'The screenshot is not blank, mostly white, or mostly black.',
      'The screenshot does not show Expo/dev-client menus, native error overlays, or stale content.',
      'Visible text and controls do not contradict the paired view-tree state JSON.',
    ],
    failCriteria: [
      'Blank, error, dev-client, launcher, or stale screen.',
      'Illegible or clipped capture that prevents judging the described state.',
      'Screenshot content contradicts the paired state JSON.',
    ],
  }
}

function readPngSize(buffer: Buffer): { width: number; height: number } {
  const signature = '89504e470d0a1a0a'
  if (buffer.subarray(0, 8).toString('hex') !== signature) {
    throw new Error('Screenshot is not a PNG')
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

test.describe('Physical iOS visual judge artifacts', () => {
  test('captures final-screen evidence for blind judging', async ({ device }, testInfo) => {
    if (!(await requireScreenshotAndViewTree(device))) {
      return
    }

    await rm(ARTIFACT_DIR, { recursive: true, force: true })
    await mkdir(ARTIFACT_DIR, { recursive: true })

    const captures: VisualCapture[] = []
    captures.push(
      await captureVisual(
        device,
        '01-immediate-launch',
        'First full-screen capture after app launch and CDP attach.',
        'The React Native example app should be visible; a blank white/black screen is a failure.',
        testInfo,
      ),
    )

    await device.evaluate<void>('globalThis.__RN_DRIVER_EXAMPLE__?.scrollToTop?.()')
    await device.getByTestId('title').waitFor({ state: 'visible', timeout: 10_000 })
    await device.getByTestId('reset-button').tap()
    await expectLocator(device.getByTestId('count-display')).toHaveText('Count: 0')
    captures.push(
      await captureVisual(
        device,
        '02-ready-reset',
        'Counter screen reset to its known starting state.',
        'The title, Count: 0, input fields, decrement/increment buttons, reset button, and drag panel should be visible.',
        testInfo,
      ),
    )

    await device.getByTestId('increment-button').tap()
    await expectLocator(device.getByTestId('count-display')).toHaveText('Count: 1')
    captures.push(
      await captureVisual(
        device,
        '03-after-increment',
        'Counter after one native locator tap on the increment button.',
        'The app should still be visible and the count display should read Count: 1.',
        testInfo,
      ),
    )

    const drag = await device.getByTestId('drag-target').bounds()
    expect(drag).not.toBeNull()
    if (drag) {
      await device.pointer.swipe({
        from: { x: drag.x + drag.width * 0.2, y: drag.y + drag.height / 2 },
        to: { x: drag.x + drag.width * 0.8, y: drag.y + drag.height / 2 },
        duration: 400,
        steps: 8,
      })
    }
    await expectLocator(device.getByTestId('drag-status')).toHaveText('ended', { exact: false })
    captures.push(
      await captureVisual(
        device,
        '04-after-drag',
        'Counter screen after an XCTest pointer drag across the drag target.',
        'The drag panel should remain visible and report an ended drag with one or more moves.',
        testInfo,
      ),
    )

    await device.getByTestId('reset-button').tap()
    await expectLocator(device.getByTestId('count-display')).toHaveText('Count: 0')
    captures.push(
      await captureVisual(
        device,
        '05-final-reset',
        'Final post-suite screen state.',
        'The app should finish on the counter screen, not a blank or dev-launcher screen, with Count: 0 visible.',
        testInfo,
      ),
    )

    const finalCount = await getCount(device)
    expect(finalCount).toBe(0)

    const manifest = {
      schemaVersion: 1,
      run: {
        createdAt: new Date().toISOString(),
        platform: device.platform,
        targetKind: process.env.RN_IOS_TARGET_KIND,
        targetId: process.env.RN_DEVICE_NAME,
      },
      app: {
        example: 'examples/basic-app',
        screen: 'Counter example',
        setup: [
          'Launch physical iOS Expo dev-client through rn-driver.ios-device.config.ts.',
          'Attach to Hermes through Metro CDP.',
          'Drive the counter, reset, increment, drag target, and final reset with native driver APIs.',
        ],
      },
      artifactRoot: ARTIFACT_DIR,
      judgeInstructions:
        'Blind judges must evaluate only the screenshots, state JSON, and expectations in this manifest. They should reject blank screens, dev-client menus, native error overlays, stale/non-counter screens, or screenshots that contradict the paired state JSON.',
      captures,
    }

    await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
    await testInfo.attach('visual-judge-manifest', {
      path: MANIFEST_PATH,
      contentType: 'application/json',
    })
  })
})
