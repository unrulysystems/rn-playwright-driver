# @0xbigboss/rn-driver-touch

## 0.2.0

### Minor Changes

- 1c9c041: feat(ios): implement UIKit touch synthesis for native touch injection
  - Replace XCTest APIs (unavailable in regular app builds) with UIKit private API touch synthesis
  - Uses same approach as KIF/EarlGrey testing frameworks
  - Supports tap, down, move, up, swipe, longPress, typeText
  - Wrapped in #if DEBUG to avoid App Store rejection - returns NOT_SUPPORTED in release builds
  - Module remains present in release builds with explicit error messages
