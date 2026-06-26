#!/usr/bin/env bash
set -euo pipefail

APP_ID="${APP_ID:-com.unrulyfall.example}"
INSTRUMENTATION_TARGET="${INSTRUMENTATION_TARGET:-com.unrulyfall.example.test/com.rndriver.touchcompanion.RNDriverTouchCompanion}"
TOUCH_PORT="${RN_TOUCH_INSTRUMENTATION_PORT:-9999}"
TOUCH_AUTH_TOKEN="${RN_TOUCH_INSTRUMENTATION_TOKEN:-}"
TOUCH_AUTH_TOKEN_FILE=""
DEVICE_TOUCH_AUTH_TOKEN_FILE="rn-driver-touch-token"
METRO_HOST="${METRO_HOST:-127.0.0.1}"
METRO_PORT_EXPLICIT="${METRO_PORT:-}"
METRO_PORT="${METRO_PORT:-8081}"
METRO_URL="${RN_METRO_URL:-http://${METRO_HOST}:${METRO_PORT}}"
APP_APK="${APP_APK:-android/app/build/outputs/apk/debug/app-debug.apk}"
TEST_APK="${TEST_APK:-android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk}"
SPECS=(
  e2e/integration/counter.spec.ts
  e2e/pointer
  e2e/scroll/scroll.spec.ts
  e2e/primitives/touch-backend.spec.ts
)

METRO_PID=""
INSTRUMENTATION_PID=""
STATUS="not-run"
METRO_LOG="$(mktemp -t rn-driver-metro.XXXXXX.log)"
INSTRUMENTATION_LOG="$(mktemp -t rn-driver-instrumentation.XXXXXX.log)"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

cleanup() {
  local exit_code=$?
  set +e

  if [[ -n "$INSTRUMENTATION_PID" ]]; then
    kill "$INSTRUMENTATION_PID" >/dev/null 2>&1
    wait "$INSTRUMENTATION_PID" >/dev/null 2>&1
  fi

  if [[ -n "${SERIAL:-}" ]]; then
    adb -s "$SERIAL" reverse --remove "tcp:${METRO_PORT}" >/dev/null 2>&1
    adb -s "$SERIAL" reverse --remove "tcp:8081" >/dev/null 2>&1
    adb -s "$SERIAL" forward --remove "tcp:${TOUCH_PORT}" >/dev/null 2>&1
    adb -s "$SERIAL" shell run-as "$APP_ID" rm -f "files/${DEVICE_TOUCH_AUTH_TOKEN_FILE}" >/dev/null 2>&1
    adb -s "$SERIAL" shell am force-stop "$APP_ID" >/dev/null 2>&1
  fi

  if [[ -n "$METRO_PID" ]]; then
    kill "$METRO_PID" >/dev/null 2>&1
    wait "$METRO_PID" >/dev/null 2>&1
  fi

  if [[ -n "$TOUCH_AUTH_TOKEN_FILE" ]]; then
    rm -f "$TOUCH_AUTH_TOKEN_FILE"
  fi

  echo "Android instrumentation e2e summary:"
  echo "  instrumentation: ${STATUS}"
  echo "  metro log: ${METRO_LOG}"
  echo "  instrumentation log: ${INSTRUMENTATION_LOG}"

  exit "$exit_code"
}
trap cleanup EXIT

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

port_is_open() {
  nc -z "$METRO_HOST" "$1" >/dev/null 2>&1
}

select_metro_port() {
  if [[ -n "${RN_METRO_URL:-}" ]]; then
    read -r METRO_HOST METRO_PORT < <(node <<'NODE'
const url = new URL(process.env.RN_METRO_URL)
const port = url.port || (url.protocol === 'https:' ? '443' : '80')
console.log(`${url.hostname} ${port}`)
NODE
)
    return
  fi

  if [[ -n "$METRO_PORT_EXPLICIT" ]]; then
    if port_is_open "$METRO_PORT"; then
      fail "METRO_PORT=${METRO_PORT} is already in use. Stop that server or choose a different METRO_PORT."
    fi
    METRO_URL="http://${METRO_HOST}:${METRO_PORT}"
    return
  fi

  local port
  for port in $(seq "$METRO_PORT" $((METRO_PORT + 20))); do
    if ! port_is_open "$port"; then
      METRO_PORT="$port"
      METRO_URL="http://${METRO_HOST}:${METRO_PORT}"
      return
    fi
  done

  fail "no free Metro port found starting at ${METRO_PORT}"
}

install_device_touch_auth_token() {
  adb -s "$SERIAL" shell run-as "$APP_ID" sh -c \
    "'cat > files/${DEVICE_TOUCH_AUTH_TOKEN_FILE} && chmod 600 files/${DEVICE_TOUCH_AUTH_TOKEN_FILE}'" \
    <"$TOUCH_AUTH_TOKEN_FILE" || fail "failed to install instrumentation auth token into ${APP_ID} private files"
}

pick_emulator_serial() {
  adb start-server >/dev/null

  if [[ -n "${RN_DEVICE_ID:-}" ]]; then
    adb -s "$RN_DEVICE_ID" get-state >/dev/null 2>&1 || fail "RN_DEVICE_ID is not reachable via adb: ${RN_DEVICE_ID}"
    echo "$RN_DEVICE_ID"
    return
  fi

  local serial
  serial="$(adb devices | awk 'NR > 1 && $2 == "device" && $1 ~ /^emulator-/ { print $1; exit }')"
  [[ -n "$serial" ]] || fail "no booted emulator found in adb devices"
  echo "$serial"
}

require_booted_device() {
  local boot_completed
  local state

  state="$(adb -s "$SERIAL" get-state 2>/dev/null | tr -d '\r')"
  [[ "$state" == "device" ]] || fail "adb device ${SERIAL} is not ready; get-state returned ${state}"

  boot_completed="$(adb -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
  [[ "$boot_completed" == "1" ]] || fail "adb device ${SERIAL} is connected but Android has not completed boot"
}

wait_for_metro() {
  for _ in {1..90}; do
    if curl -fsS "${METRO_URL}/status" 2>/dev/null | grep -q 'packager-status:running'; then
      return 0
    fi
    sleep 1
  done

  echo "Metro did not become ready at ${METRO_URL}/status" >&2
  tail -n 80 "$METRO_LOG" >&2 || true
  return 1
}

wait_for_hermes_target() {
  for _ in {1..45}; do
    if select_android_hermes_target_name quiet >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Hermes target for ${APP_ID} did not appear at ${METRO_URL}/json" >&2
  echo "Metro /json response:" >&2
  curl -fsS "${METRO_URL}/json" >&2 || true
  echo >&2
  echo "App pid:" >&2
  adb -s "$SERIAL" shell pidof "$APP_ID" >&2 || true
  echo "Recent logcat lines for ${APP_ID}:" >&2
  adb -s "$SERIAL" logcat -d -t 120 | grep -E "${APP_ID}|ReactNative|AndroidRuntime|RNDriver" >&2 || true
  echo "Metro log tail:" >&2
  tail -n 80 "$METRO_LOG" >&2 || true
  return 1
}

select_android_hermes_target_name() {
  local mode="${1:-verbose}"
  node - "$METRO_URL" "$APP_ID" "$mode" <<'NODE'
const [metroUrl, appId, mode] = process.argv.slice(2)

const isReactNativeTarget = (target) =>
  String(target.title ?? '').includes('Hermes') ||
  target.vm === 'Hermes' ||
  String(target.description ?? '').includes('React Native')

const isAndroidTarget = (target) =>
  /android|pixel|samsung|gphone|sdk_/i.test(`${target.deviceName ?? ''} ${target.title ?? ''}`)

try {
  const response = await fetch(`${metroUrl}/json`)
  if (!response.ok) {
    throw new Error(`Metro /json returned HTTP ${response.status}`)
  }

  const targets = await response.json()
  const appTargets = targets.filter((target) => target.appId === appId && isReactNativeTarget(target))
  const target = appTargets.find(isAndroidTarget)

  if (!target) {
    if (mode !== 'quiet') {
      console.error(`No Android Hermes target for ${appId}. Targets: ${JSON.stringify(targets)}`)
    }
    process.exit(1)
  }

  process.stdout.write(target.deviceName ?? target.title ?? '')
} catch (error) {
  if (mode !== 'quiet') {
    console.error(error instanceof Error ? error.message : String(error))
  }
  process.exit(1)
}
NODE
}

wait_for_instrumentation() {
  local hello_url="http://127.0.0.1:${TOUCH_PORT}/command"

  for _ in {1..45}; do
    if ! kill -0 "$INSTRUMENTATION_PID" >/dev/null 2>&1; then
      echo "Instrumentation companion exited before accepting connections" >&2
      tail -n 80 "$INSTRUMENTATION_LOG" >&2 || true
      return 1
    fi

    if RN_TOUCH_INSTRUMENTATION_PROBE_URL="$hello_url" \
      RN_TOUCH_INSTRUMENTATION_TOKEN_FILE="$TOUCH_AUTH_TOKEN_FILE" \
      node <<'NODE' >/dev/null 2>&1; then
const fs = require('node:fs')

const url = process.env.RN_TOUCH_INSTRUMENTATION_PROBE_URL
const tokenFile = process.env.RN_TOUCH_INSTRUMENTATION_TOKEN_FILE
if (!url || !tokenFile) {
  process.exit(1)
}

const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 1000)

;(async () => {
  try {
    const token = fs.readFileSync(tokenFile, 'utf8').trim()
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-rn-driver-auth': token,
      },
      body: JSON.stringify({ type: 'hello' }),
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => undefined)
    process.exit(response.ok && payload?.ok === true ? 0 : 1)
  } catch {
    process.exit(1)
  } finally {
    clearTimeout(timeout)
  }
})()
NODE
      return 0
    fi
    sleep 1
  done

  echo "Instrumentation companion did not accept ${hello_url}" >&2
  tail -n 80 "$INSTRUMENTATION_LOG" >&2 || true
  return 1
}

configure_jdk() {
  if [[ -n "${JAVA_HOME:-}" ]]; then
    return
  fi

  if [[ -x /usr/libexec/java_home ]]; then
    local java_home
    java_home="$(/usr/libexec/java_home -v 17 2>/dev/null || true)"
    if [[ -n "$java_home" ]]; then
      export JAVA_HOME="$java_home"
    fi
  fi
}

set_debug_http_host() {
  local debug_host="localhost:${METRO_PORT}"

  adb -s "$SERIAL" reverse "tcp:${METRO_PORT}" "tcp:${METRO_PORT}" >/dev/null
  if [[ "$METRO_PORT" != "8081" ]]; then
    adb -s "$SERIAL" reverse "tcp:8081" "tcp:${METRO_PORT}" >/dev/null
  fi
  adb -s "$SERIAL" shell setprop metro.host localhost >/dev/null 2>&1 || true

  printf "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n  <string name=\"debug_http_host\">%s</string>\n</map>\n" "$debug_host" \
    | adb -s "$SERIAL" shell "run-as $APP_ID sh -c 'mkdir -p /data/data/$APP_ID/shared_prefs && cat > /data/data/$APP_ID/shared_prefs/${APP_ID}_preferences.xml'"

  echo "Configured ${APP_ID} debug_http_host=${debug_host} with adb reverse tcp:${METRO_PORT}->tcp:${METRO_PORT}"
}

collapse_system_overlays() {
  adb -s "$SERIAL" shell cmd statusbar collapse >/dev/null 2>&1 || true
  adb -s "$SERIAL" shell input keyevent KEYCODE_BACK >/dev/null 2>&1 || true
}

launch_app() {
  local force_stop="${1:-false}"
  local attempts=3

  if [[ "$force_stop" != "true" ]]; then
    attempts=2
  fi

  for attempt in $(seq 1 "$attempts"); do
    if [[ "$force_stop" == "true" ]]; then
      adb -s "$SERIAL" shell am force-stop "$APP_ID" >/dev/null
    fi

    adb -s "$SERIAL" shell am start -W -n "$APP_ID/.MainActivity" >/dev/null
    if wait_for_hermes_target; then
      return 0
    fi

    echo "Launch attempt ${attempt}/${attempts} did not expose a Hermes target" >&2
    sleep 2
  done

  return 1
}

require_command adb
require_command curl
require_command nc
require_command node
require_command npx
select_metro_port
if [[ -z "$TOUCH_AUTH_TOKEN" ]]; then
  require_command openssl
  TOUCH_AUTH_TOKEN="$(openssl rand -hex 16)"
fi
TOUCH_AUTH_TOKEN_FILE="$(mktemp -t rn-driver-touch-token.XXXXXX)"
chmod 600 "$TOUCH_AUTH_TOKEN_FILE"
printf '%s' "$TOUCH_AUTH_TOKEN" >"$TOUCH_AUTH_TOKEN_FILE"

SERIAL="$(pick_emulator_serial)"
export SERIAL
export ANDROID_SERIAL="$SERIAL"
require_booted_device

echo "Using Android device ${SERIAL}"
echo "Generating Android project with Expo prebuild"
npx expo prebuild --platform android --no-install

echo "Building app and androidTest APKs"
configure_jdk
(
  cd android
  ./gradlew :app:assembleDebug :app:assembleDebugAndroidTest
)

[[ -f "$APP_APK" ]] || fail "app APK not found: ${APP_APK}"
[[ -f "$TEST_APK" ]] || fail "androidTest APK not found: ${TEST_APK}"

echo "Installing ${APP_APK}"
adb -s "$SERIAL" install -r "$APP_APK"
echo "Installing ${TEST_APK}"
adb -s "$SERIAL" install -r -t "$TEST_APK"
install_device_touch_auth_token

echo "Starting Metro at ${METRO_URL}"
CI=1 EXPO_NO_TELEMETRY=1 npx expo start --localhost --port "$METRO_PORT" >"$METRO_LOG" 2>&1 &
METRO_PID="$!"
wait_for_metro

set_debug_http_host
collapse_system_overlays
echo "Launching ${APP_ID}"
launch_app true

echo "Starting instrumentation companion ${INSTRUMENTATION_TARGET} on port ${TOUCH_PORT}"
adb -s "$SERIAL" forward "tcp:${TOUCH_PORT}" "tcp:${TOUCH_PORT}"
adb -s "$SERIAL" shell am instrument \
  -e rnDriverAuthTokenFile "$DEVICE_TOUCH_AUTH_TOKEN_FILE" \
  -e rnDriverPort "$TOUCH_PORT" \
  -w "$INSTRUMENTATION_TARGET" >"$INSTRUMENTATION_LOG" 2>&1 &
INSTRUMENTATION_PID="$!"
wait_for_instrumentation
collapse_system_overlays
launch_app false

TARGET_DEVICE_NAME="$(select_android_hermes_target_name)"
[[ -n "$TARGET_DEVICE_NAME" ]] || fail "could not resolve Android Hermes target name"
echo "Selected Android Hermes target '${TARGET_DEVICE_NAME}'"

echo "Running Android e2e with RN_TOUCH_BACKEND=instrumentation"
if RN_TOUCH_BACKEND=instrumentation \
  RN_TOUCH_INSTRUMENTATION_PORT="$TOUCH_PORT" \
  RN_TOUCH_INSTRUMENTATION_TOKEN_FILE="$TOUCH_AUTH_TOKEN_FILE" \
  RN_METRO_URL="$METRO_URL" \
  RN_DEVICE_NAME="$TARGET_DEVICE_NAME" \
  ANDROID_SERIAL="$SERIAL" \
  npx playwright test "${SPECS[@]}" --reporter=line; then
  STATUS="pass"
else
  STATUS="fail"
fi

[[ "$STATUS" == "pass" ]] || fail "instrumentation backend e2e run failed"

echo "PASS: Android instrumentation e2e passed"
