import path from 'node:path'

/**
 * Locate the application product of an Xcode scheme from the JSON that
 * `xcodebuild -showBuildSettings -json` prints for the same workspace, scheme,
 * and destination the app was built with (REQ-IOS-015). Pure; the capture and
 * the install live in the process runner.
 */
const APPLICATION_PRODUCT_TYPE = 'com.apple.product-type.application'

interface BuildSettingsEntry {
  readonly target?: unknown
  readonly buildSettings?: Readonly<Record<string, unknown>>
}

export function builtApplicationPath(showBuildSettingsJson: string): string {
  let entries: unknown
  try {
    entries = JSON.parse(showBuildSettingsJson)
  } catch (error) {
    throw new Error(
      `xcodebuild -showBuildSettings -json returned invalid JSON: ${(error as Error).message}`,
      { cause: error },
    )
  }
  if (!Array.isArray(entries)) {
    throw new Error('xcodebuild -showBuildSettings -json did not return a list of targets')
  }
  const targets = entries as readonly BuildSettingsEntry[]
  const app = targets.find(
    (entry) => entry.buildSettings?.PRODUCT_TYPE === APPLICATION_PRODUCT_TYPE,
  )
  if (!app) {
    const names = targets.map((entry) => String(entry.target ?? '?')).join(', ')
    throw new Error(`the scheme builds no application target (targets: ${names || 'none'})`)
  }
  const dir = app.buildSettings?.BUILT_PRODUCTS_DIR
  const name = app.buildSettings?.FULL_PRODUCT_NAME
  if (typeof dir !== 'string' || dir === '' || typeof name !== 'string' || name === '') {
    throw new Error(
      `application target ${String(app.target)} reports no BUILT_PRODUCTS_DIR/FULL_PRODUCT_NAME`,
    )
  }
  return path.join(dir, name)
}
