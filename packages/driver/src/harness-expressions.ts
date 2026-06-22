import type { Capabilities } from './types'

const HARNESS_GLOBAL = 'globalThis.__RN_DRIVER__'

export function buildHarnessCall(path: string, args?: string): string {
  const suffix = args === undefined ? '' : args
  return `${HARNESS_GLOBAL}.${path}(${suffix})`
}

export function buildCapabilitiesExpression(): string {
  const capabilitiesPath = `${HARNESS_GLOBAL}?.capabilities`
  const fallback: Capabilities = {
    apiVersion: 0,
    viewTree: false,
    viewTreeTap: false,
    screenshot: false,
    screenshotCaptureElement: false,
    lifecycle: false,
    touchNative: false,
  }

  return `({
    apiVersion: ${capabilitiesPath}?.apiVersion ?? ${fallback.apiVersion},
    viewTree: ${capabilitiesPath}?.viewTree ?? ${fallback.viewTree},
    viewTreeTap: ${capabilitiesPath}?.viewTreeTap ?? ${fallback.viewTreeTap},
    screenshot: ${capabilitiesPath}?.screenshot ?? ${fallback.screenshot},
    screenshotCaptureElement: ${capabilitiesPath}?.screenshotCaptureElement ?? ${fallback.screenshotCaptureElement},
    lifecycle: ${capabilitiesPath}?.lifecycle ?? ${fallback.lifecycle},
    touchNative: ${capabilitiesPath}?.touchNative ?? ${fallback.touchNative},
  })`
}
