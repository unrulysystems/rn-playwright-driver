# CI Setup Guide

This guide covers setting up CI pipelines for React Native E2E tests with
rn-playwright-driver. The release confidence path is companion-backed input:
Android runs the instrumentation companion and iOS runs the XCTest companion.
`native-module` and `cli` are explicit lower-fidelity escape hatches, not CI
release gates.

## Prerequisites

- React Native app with Hermes runtime
- Metro bundler debug endpoints enabled
- Expo Modules API for native modules

## iOS Simulator Setup

### Install Xcode Command Line Tools

```bash
xcode-select --install
```

### List Available Simulators

```bash
xcrun simctl list devices available
```

### Boot a Simulator

```bash
# Boot by device type
xcrun simctl boot "iPhone 15 Pro"

# Or boot a specific UDID
xcrun simctl boot <DEVICE_UDID>
```

### Build and Run

```bash
# For Expo
expo run:ios --device "iPhone 15 Pro"

# Or with npx
npx expo run:ios --device "iPhone 15 Pro"
```

## Android Emulator Setup

### Install Android SDK

```bash
# Install command line tools
brew install --cask android-commandlinetools

# Accept licenses
sdkmanager --licenses

# Install platform tools and emulator
sdkmanager "platform-tools" "emulator"
sdkmanager "platforms;android-34" "system-images;android-34;google_apis;arm64-v8a"
```

### Create AVD (Android Virtual Device)

```bash
avdmanager create avd \
  --name "Pixel_7_API_34" \
  --package "system-images;android-34;google_apis;arm64-v8a" \
  --device "pixel_7"
```

### Start Emulator

```bash
emulator -avd Pixel_7_API_34 -no-audio -no-boot-anim
```

### Build and Run

```bash
# For Expo
expo run:android

# Or with npx
npx expo run:android
```

## Hermes + Metro Requirements

### Verify Hermes is Enabled

Check `app.json` or `app.config.js`:

```json
{
  "expo": {
    "jsEngine": "hermes"
  }
}
```

### Metro Debug Endpoints

The driver connects via Metro's `/json` endpoint. Ensure Metro is running:

```bash
# Start Metro
npx expo start

# Or start with specific port
npx expo start --port 8081
```

The debug endpoint should be available at `http://localhost:8081/json`.

## Companion E2E Gates

The example app owns repeatable scripts that build the app, start Metro, start
the platform companion, run the relevant touch suite, and clean up forwarded
ports/processes:

```bash
cd examples/basic-app
bun run test:e2e:android # RN_TOUCH_BACKEND=instrumentation
bun run test:e2e:ios     # RN_TOUCH_BACKEND=xctest
```

Those commands are the official example confidence gates. They replace older
dual/native-module lanes for release validation.

## GitHub Actions Example

```yaml
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ios-e2e:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Boot iOS Simulator
        run: |
          xcrun simctl boot "iPhone 15 Pro" || true
          xcrun simctl bootstatus "iPhone 15 Pro" -b

      - name: Run XCTest companion E2E
        working-directory: examples/basic-app
        run: bun run test:e2e:ios

  android-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17

      - name: Setup Android SDK
        uses: android-actions/setup-android@v3

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Run instrumentation companion E2E
        uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: 34
          target: google_apis
          arch: x86_64
          profile: pixel_6
          script: |
            cd examples/basic-app
            bun run test:e2e:android
```

## Environment Variables

| Variable         | Description           | Default                 |
| ---------------- | --------------------- | ----------------------- |
| `RN_METRO_URL`   | Metro bundler URL     | `http://localhost:8081` |
| `RN_DEVICE_ID`   | Device ID to match    | _unset_                 |
| `RN_DEVICE_NAME` | Device name substring | _unset_                 |
| `RN_TIMEOUT`     | Request timeout (ms)  | `30000`                 |

| Variable                              | Description                                       | Default        |
| ------------------------------------- | ------------------------------------------------- | -------------- |
| `RN_TOUCH_BACKEND`                    | Forced touch backend for CI scripts               | script-set     |
| `RN_TOUCH_INSTRUMENTATION_PORT`       | Local Android companion forward port              | `9999`         |
| `RN_TOUCH_INSTRUMENTATION_TOKEN_FILE` | Local file containing the Android companion token | script-created |
| `RN_TOUCH_XCTEST_PORT`                | Local XCTest companion WebSocket port             | `9999`         |
| `RN_TOUCH_XCTEST_TOKEN_FILE`          | Local file containing the XCTest companion token  | script-created |

## iOS XCTest Caveat

XCTest is the iOS confidence backend because it drives platform input outside
the app process. Its low-level `down`/`move`/`up` behavior is necessarily
coarser than Android instrumentation for continuous pointer streams: the
companion buffers the sequence into XCTest gestures where XCTest requires a
complete gesture. Treat tap, drag, swipe, path, and locator interactions as the
release gate; keep native stream-level assertions platform-aware.

## Troubleshooting

### Metro Connection Issues

1. Verify Metro is running: `curl http://localhost:8081/json`
2. Check the app is connected to Metro (shake device > Debug)
3. Ensure Hermes is enabled in app config

### Simulator/Emulator Issues

1. iOS: Reset simulator with `xcrun simctl erase all`
2. Android: Cold boot emulator with `-no-snapshot`
3. Check device logs for crash information

### Test Timeouts

1. Increase `RN_TIMEOUT` environment variable
2. Check app startup time
3. Verify native modules are installed correctly
