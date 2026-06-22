#!/usr/bin/env bun
/**
 * Element Inspector CLI for React Native apps.
 *
 * Connects to a running RN app via Hermes CDP and queries the view tree.
 * Useful for exploring element structure and generating locator code.
 *
 * Usage:
 *   bun run packages/driver/bin/inspect.ts [options] [selector]
 *
 * Options:
 *   --metro-url, -m   Metro bundler URL (default: http://localhost:8081)
 *   --device-id, -d   Device ID to connect to
 *   --device-name     Device name to match (substring)
 *   --timeout, -t     Request timeout in ms (default: 30000)
 *   --json            Output as JSON
 *   --help, -h        Show help
 *
 * Selector formats:
 *   testId:myButton   Find by testID
 *   text:Hello        Find by text (substring)
 *   text:=Hello       Find by text (exact)
 *   role:button       Find by role
 *   role:button:Save  Find by role with name
 *   (no selector)     Show capabilities and harness info
 */

import { parseArgs } from 'node:util'
import type { ElementBounds, ElementInfo, NativeResult } from '@0xbigboss/rn-driver-shared-types'
// Import from dist (built output) since src is not shipped in the package
import { createDevice, type RNDeviceOptions } from '../dist/index.mjs'

function printHelp(): void {
  console.log(`
RN Playwright Driver - Element Inspector

Usage:
  bun run packages/driver/bin/inspect.ts [options] [selector]

Options:
  --metro-url, -m   Metro bundler URL (default: http://localhost:8081)
  --device-id, -d   Device ID to connect to
  --device-name     Device name to match (substring)
  --timeout, -t     Request timeout in ms (default: 30000)
  --json            Output as JSON
  --help, -h        Show help

Selector formats:
  testId:myButton   Find by testID
  text:Hello        Find by text (substring)
  text:=Hello       Find by text (exact)
  role:button       Find by role
  role:button:Save  Find by role with name
  (no selector)     Show capabilities and harness info

Examples:
  bun run bin/inspect.ts
  bun run bin/inspect.ts testId:submit-button
  bun run bin/inspect.ts text:Login
  bun run bin/inspect.ts role:button --json
`)
}

function formatBounds(bounds: ElementBounds): string {
  return `(${bounds.x}, ${bounds.y}) ${bounds.width}x${bounds.height}`
}

function formatElement(el: ElementInfo, indent = ''): string {
  const lines: string[] = []
  lines.push(`${indent}handle: ${el.handle}`)
  if (el.testId) lines.push(`${indent}testId: ${el.testId}`)
  if (el.text) lines.push(`${indent}text: "${el.text}"`)
  if (el.role) lines.push(`${indent}role: ${el.role}`)
  if (el.label) lines.push(`${indent}label: "${el.label}"`)
  lines.push(`${indent}bounds: ${formatBounds(el.bounds)}`)
  lines.push(`${indent}visible: ${el.visible}`)
  lines.push(`${indent}enabled: ${el.enabled}`)
  return lines.join('\n')
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'metro-url': { type: 'string', short: 'm' },
      'device-id': { type: 'string', short: 'd' },
      'device-name': { type: 'string' },
      timeout: { type: 'string', short: 't' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  })

  if (values.help) {
    printHelp()
    process.exit(0)
  }

  const options: RNDeviceOptions = {}
  if (values['metro-url']) options.metroUrl = values['metro-url']
  if (values['device-id']) options.deviceId = values['device-id']
  if (values['device-name']) options.deviceName = values['device-name']
  if (values.timeout) {
    const t = Number.parseInt(values.timeout, 10)
    if (!Number.isNaN(t) && t > 0) options.timeout = t
  }

  const asJson = values.json ?? false
  const selector = positionals[0]

  const device = createDevice(options)

  try {
    if (!asJson) {
      console.log('Connecting to device...')
    }
    await device.connect()

    if (!selector) {
      // No selector - show capabilities and harness info
      const caps = await device.capabilities()
      const version = await device.evaluate<string>(
        "globalThis.__RN_DRIVER__?.version ?? 'unknown'",
      )
      const platform = device.platform

      if (asJson) {
        console.log(JSON.stringify({ version, platform, capabilities: caps }, null, 2))
      } else {
        console.log('\nHarness Info:')
        console.log(`  version: ${version}`)
        console.log(`  apiVersion: ${caps.apiVersion}`)
        console.log(`  platform: ${platform}`)
        console.log('\nCapabilities:')
        console.log(`  viewTree: ${caps.viewTree}`)
        console.log(`  viewTreeTap: ${caps.viewTreeTap}`)
        console.log(`  screenshot: ${caps.screenshot}`)
        console.log(`  screenshotCaptureElement: ${caps.screenshotCaptureElement}`)
        console.log(`  lifecycle: ${caps.lifecycle}`)
        console.log(`  touchNative: ${caps.touchNative}`)

        if (!caps.viewTree) {
          console.log(
            '\nNote: viewTree capability not available. ' +
              'Install @0xbigboss/rn-playwright-view-tree in your app.',
          )
        } else {
          console.log('\nTo query elements, use a selector:')
          console.log('  bun run bin/inspect.ts testId:myButton')
          console.log('  bun run bin/inspect.ts text:Login')
          console.log('  bun run bin/inspect.ts role:button')
        }
      }
    } else {
      // Parse selector
      const [type, ...rest] = selector.split(':')
      const value = rest.join(':')

      let result: NativeResult<ElementInfo[]>

      if (type === 'testId' && value) {
        result = await device.evaluate<NativeResult<ElementInfo[]>>(
          `globalThis.__RN_DRIVER__.viewTree.findAllByTestId(${JSON.stringify(value)})`,
        )
      } else if (type === 'text' && value) {
        const exact = value.startsWith('=')
        const text = exact ? value.slice(1) : value
        result = await device.evaluate<NativeResult<ElementInfo[]>>(
          `globalThis.__RN_DRIVER__.viewTree.findAllByText(${JSON.stringify(text)}, ${exact})`,
        )
      } else if (type === 'role' && value) {
        const [role, name] = value.split(':')
        const nameArg = name ? JSON.stringify(name) : 'undefined'
        result = await device.evaluate<NativeResult<ElementInfo[]>>(
          `globalThis.__RN_DRIVER__.viewTree.findAllByRole(${JSON.stringify(role)}, ${nameArg})`,
        )
      } else {
        console.error(`Invalid selector format: ${selector}`)
        console.error('Use: testId:value, text:value, text:=exactValue, or role:value')
        process.exit(1)
      }

      if (!result.success) {
        if (asJson) {
          console.log(JSON.stringify({ error: result.error, code: result.code }))
        } else {
          console.error(`Error: ${result.error} (${result.code})`)
        }
        process.exit(1)
      }

      const elements = result.data

      if (asJson) {
        console.log(JSON.stringify(elements, null, 2))
      } else {
        if (elements.length === 0) {
          console.log(`No elements found matching: ${selector}`)
        } else {
          console.log(`\nFound ${elements.length} element(s):\n`)
          for (let i = 0; i < elements.length; i++) {
            const el = elements[i]
            console.log(`[${i}] ${el.testId ?? el.text ?? el.role ?? el.handle}`)
            console.log(formatElement(el, '    '))
            console.log()
          }
        }
      }
    }
  } catch (error) {
    if (asJson) {
      console.log(JSON.stringify({ error: String(error) }))
    } else {
      console.error('Error:', error)
    }
    process.exit(1)
  } finally {
    await device.disconnect()
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
