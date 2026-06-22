# CI Setup Guide

This guide covers setting up CI pipelines for React Native E2E tests with rn-playwright-driver.

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

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: bun install

      - name: Boot iOS Simulator
        run: |
          xcrun simctl boot "iPhone 15 Pro"

      - name: Install Expo CLI
        run: npm install -g expo-cli

      - name: Build iOS app
        run: expo run:ios --no-bundler --device "iPhone 15 Pro"

      - name: Start Metro
        run: npx expo start &
        env:
          CI: true

      - name: Wait for Metro
        run: npx wait-on http://localhost:8081/json --timeout 60000

      - name: Run E2E tests
        run: bun run test:e2e

  android-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17

      - name: Setup Android SDK
        uses: android-actions/setup-android@v3

      - name: Install dependencies
        run: bun install

      - name: Create AVD
        run: |
          echo "y" | sdkmanager "system-images;android-34;google_apis;x86_64"
          echo "no" | avdmanager create avd -n test_avd -k "system-images;android-34;google_apis;x86_64" --force

      - name: Start Emulator
        uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: 34
          target: google_apis
          arch: x86_64
          profile: pixel_6
          script: |
            npx expo run:android --no-bundler
            npx expo start &
            npx wait-on http://localhost:8081/json --timeout 60000
            bun run test:e2e
```

## Environment Variables

| Variable         | Description           | Default                 |
| ---------------- | --------------------- | ----------------------- |
| `RN_METRO_URL`   | Metro bundler URL     | `http://localhost:8081` |
| `RN_DEVICE_ID`   | Device ID to match    | _unset_                 |
| `RN_DEVICE_NAME` | Device name substring | _unset_                 |
| `RN_TIMEOUT`     | Request timeout (ms)  | `30000`                 |

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
