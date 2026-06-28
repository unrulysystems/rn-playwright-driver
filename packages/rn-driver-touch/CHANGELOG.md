# @unrulysystems/rn-driver-touch

## 0.2.1

### Patch Changes

- [#30](https://github.com/unrulysystems/rn-playwright-driver/pull/30) [`4bdbe20`](https://github.com/unrulysystems/rn-playwright-driver/commit/4bdbe2073f7b613f6bfb8d5a13db5e0ca000e1c5) Thanks [@alleneubank](https://github.com/alleneubank)! - Upgrade the dogfood example and native module tooling to Expo SDK 56.

  The driver now sends a React Native inspector-compatible WebSocket Origin when
  attaching to Hermes CDP, which keeps Expo SDK 56 dev-client debugging connected
  on localhost Metro servers. The runner also fast-fails companion readiness when
  captured iOS or Android companion logs contain terminal build, test, or
  instrumentation failure markers instead of waiting for the full probe timeout.

## 0.2.0

### Minor Changes

- 1c9c041: feat(ios): implement UIKit touch synthesis for native touch injection
  - Replace XCTest APIs (unavailable in regular app builds) with UIKit private API touch synthesis
  - Uses same approach as KIF/EarlGrey testing frameworks
  - Supports tap, down, move, up, swipe, longPress, typeText
  - Wrapped in #if DEBUG to avoid App Store rejection - returns NOT_SUPPORTED in release builds
  - Module remains present in release builds with explicit error messages
