# RN Driver Touch Instrumentation Companion

Android instrumentation sidecar for `@unrulysystems/rn-playwright-driver`.
It starts a small HTTP server in a separate instrumentation process and injects
OS-level touch events through `UiAutomation.injectInputEvent`.

## Consumption

Install the package in the app under test and add the config plugin:

```json
{
  "expo": {
    "plugins": ["@unrulysystems/rn-playwright-driver-instrumentation-companion"]
  }
}
```

During `expo prebuild`, the plugin:

- copies `RNDriverTouchCompanion.kt` into `android/app/src/androidTest/java`;
- writes `android/app/src/androidTest/AndroidManifest.xml` with the
  instrumentation registration;
- adds `androidx.test:runner` and `androidx.test:core` as `androidTestImplementation`
  dependencies;
- sets `testInstrumentationRunner` to
  `com.rndriver.touchcompanion.RNDriverTouchCompanion` when the app build file
  does not already define a runner.

The plugin requires `expo.android.package` so the androidTest manifest can target
the app package. The packaged Android manifest uses `${applicationId}` as the
target package placeholder; if a consuming build cannot resolve that placeholder,
copy the manifest below and replace it with the app id.

## Manual Device Flow

Regenerate the native project:

```bash
npx expo prebuild --platform android
```

Build the app APK and the androidTest instrumentation APK:

```bash
cd android
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest
```

Install both APKs:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
```

Forward the companion port and launch the instrumentation:

```bash
adb forward tcp:9999 tcp:9999
adb shell am instrument -w <app>.test/com.rndriver.touchcompanion.RNDriverTouchCompanion
```

Configure the driver to force the instrumentation backend:

```ts
const device = createDevice({
  touch: {
    mode: 'force',
    backend: 'instrumentation',
    instrumentation: { port: 9999 },
  },
})
```

## Raw Assets

If the config plugin cannot be used, copy these assets after `expo prebuild`:

- `android/src/main/java/com/rndriver/touchcompanion/RNDriverTouchCompanion.kt`
  to `android/app/src/androidTest/java/com/rndriver/touchcompanion/RNDriverTouchCompanion.kt`;
- the manifest below to `android/app/src/androidTest/AndroidManifest.xml`;
- the Gradle dependency snippet below into `android/app/build.gradle`.

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
  package="<app>.test">
  <instrumentation
    android:name="com.rndriver.touchcompanion.RNDriverTouchCompanion"
    android:targetPackage="<app>"
    android:functionalTest="false"
    android:handleProfiling="false"
    android:label="RN Driver Touch Companion" />
</manifest>
```

```gradle
android {
  defaultConfig {
    testInstrumentationRunner "com.rndriver.touchcompanion.RNDriverTouchCompanion"
  }
}

dependencies {
  androidTestImplementation "androidx.test:runner:1.6.2"
  androidTestImplementation "androidx.test:core:1.6.1"
}
```

## Protocol

POST `/command` with a JSON body.

| Command     | Body                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| `hello`     | `{ "type": "hello" }`                                                                                |
| `tap`       | `{ "type": "tap", "x": 10, "y": 20 }`                                                                |
| `down`      | `{ "type": "down", "x": 10, "y": 20 }`                                                               |
| `move`      | `{ "type": "move", "x": 15, "y": 25 }`                                                               |
| `up`        | `{ "type": "up" }`                                                                                   |
| `swipe`     | `{ "type": "swipe", "from": { "x": 10, "y": 20 }, "to": { "x": 100, "y": 200 }, "durationMs": 300 }` |
| `longPress` | `{ "type": "longPress", "x": 10, "y": 20, "durationMs": 500 }`                                       |
| `typeText`  | `{ "type": "typeText", "text": "hello" }`                                                            |

Responses are JSON envelopes:

```ts
type TouchCompanionResponse =
  | { ok: true; result?: unknown }
  | { ok: false; error: { message: string; code?: string } }
```

Coordinates are logical points (dp). The companion converts them to pixels using
the target display density before injecting motion events.
