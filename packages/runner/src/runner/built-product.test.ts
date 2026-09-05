import { describe, expect, it } from 'vitest'
import { builtApplicationPath } from './built-product'

const settings = (entries: unknown[]): string => JSON.stringify(entries)

describe('builtApplicationPath (REQ-IOS-015)', () => {
  it('joins BUILT_PRODUCTS_DIR and FULL_PRODUCT_NAME of the application target, ignoring pods and test bundles', () => {
    const json = settings([
      {
        target: 'Pods-SendPreview',
        buildSettings: { PRODUCT_TYPE: 'com.apple.product-type.library.static' },
      },
      {
        target: 'SendPreview',
        buildSettings: {
          PRODUCT_TYPE: 'com.apple.product-type.application',
          BUILT_PRODUCTS_DIR: '/DerivedData/SendPreview-abc/Build/Products/Debug-iphonesimulator',
          FULL_PRODUCT_NAME: 'SendPreview.app',
        },
      },
      {
        target: 'SendPreviewUITests',
        buildSettings: { PRODUCT_TYPE: 'com.apple.product-type.bundle.ui-testing' },
      },
    ])
    expect(builtApplicationPath(json)).toBe(
      '/DerivedData/SendPreview-abc/Build/Products/Debug-iphonesimulator/SendPreview.app',
    )
  })

  it('names the targets when none is an application', () => {
    expect(() => builtApplicationPath(settings([{ target: 'Pods', buildSettings: {} }]))).toThrow(
      'no application target (targets: Pods)',
    )
  })

  it('fails on missing product settings and on non-JSON output', () => {
    expect(() =>
      builtApplicationPath(
        settings([
          { target: 'App', buildSettings: { PRODUCT_TYPE: 'com.apple.product-type.application' } },
        ]),
      ),
    ).toThrow('App reports no BUILT_PRODUCTS_DIR/FULL_PRODUCT_NAME')
    expect(() => builtApplicationPath('xcodebuild: error: nope')).toThrow('invalid JSON')
    expect(() => builtApplicationPath('{}')).toThrow('list of targets')
  })
})
