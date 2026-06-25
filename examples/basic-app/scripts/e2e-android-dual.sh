#!/usr/bin/env bash
set -euo pipefail

APP_ID="${APP_ID:-com.unrulyfall.example}"
INSTRUMENTATION_TARGET="${INSTRUMENTATION_TARGET:-com.unrulyfall.example.test/com.rndriver.touchcompanion.RNDriverTouchCompanion}"
TOUCH_PORT="${RN_TOUCH_INSTRUMENTATION_PORT:-9999}"
METRO_HOST="${METRO_HOST:-127.0.0.1}"
METRO_PORT="${METRO_PORT:-8081}"
METRO_URL="${RN_METRO_URL:-http://${METRO_HOST}:${METRO_PORT}}"
APP_APK="${APP_APK:-android/app/build/outputs/apk/debug/app-debug.apk}"
TEST_APK="${TEST_APK:-android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk}"
SPECS=(e2e/integration/counter.spec.ts e2e/primitives/touch-backend.spec.ts)

METRO_PID=""
INSTRUMENTATION_PID=""
CLI_STATUS="not-run"
INSTRUMENTATION_STATUS="not-run"
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
    adb -s "$SERIAL" forward --remove "tcp:${TOUCH_PORT}" >/dev/null 2>&1
    adb -s "$SERIAL" shell am force-stop "$APP_ID" >/dev/null 2>&1
  fi

  if [[ -n "$METRO_PID" ]]; then
    kill "$METRO_PID" >/dev/null 2>&1
    wait "$METRO_PID" >/dev/null 2>&1
  fi

  echo "Android dual-backend e2e summary:"
  echo "  cli: ${CLI_STATUS}"
  echo "  instrumentation: ${INSTRUMENTATION_STATUS}"
  echo "  metro log: ${METRO_LOG}"
  echo "  instrumentation log: ${INSTRUMENTATION_LOG}"

  exit "$exit_code"
}
trap cleanup EXIT

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
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

wait_for_instrumentation() {
  local hello_url="http://127.0.0.1:${TOUCH_PORT}/command"

  for _ in {1..45}; do
    if ! kill -0 "$INSTRUMENTATION_PID" >/dev/null 2>&1; then
      echo "Instrumentation companion exited before accepting connections" >&2
      tail -n 80 "$INSTRUMENTATION_LOG" >&2 || true
      return 1
    fi

    if curl -fsS -m 1 -X POST -H 'content-type: application/json' --data '{"type":"hello"}' "$hello_url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Instrumentation companion did not accept ${hello_url}" >&2
  tail -n 80 "$INSTRUMENTATION_LOG" >&2 || true
  return 1
}

run_backend() {
  local backend="$1"
  shift

  echo "Running Android e2e smoke with RN_TOUCH_BACKEND=${backend}"
  if RN_TOUCH_BACKEND="$backend" \
    RN_TOUCH_INSTRUMENTATION_PORT="$TOUCH_PORT" \
    RN_METRO_URL="$METRO_URL" \
    RN_DEVICE_ID="$SERIAL" \
    ANDROID_SERIAL="$SERIAL" \
    "$@"; then
    return 0
  fi

  return 1
}

require_command adb
require_command curl
require_command npx

SERIAL="$(pick_emulator_serial)"
export SERIAL
export ANDROID_SERIAL="$SERIAL"
require_booted_device

echo "Using Android device ${SERIAL}"
echo "Generating Android project with Expo prebuild"
npx expo prebuild --platform android

echo "Building app and androidTest APKs"
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

echo "Starting Metro at ${METRO_URL}"
CI=1 EXPO_NO_TELEMETRY=1 npx expo start --localhost --port "$METRO_PORT" >"$METRO_LOG" 2>&1 &
METRO_PID="$!"
wait_for_metro

echo "Launching ${APP_ID}"
adb -s "$SERIAL" shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null

if run_backend cli npx playwright test "${SPECS[@]}"; then
  CLI_STATUS="pass"
else
  CLI_STATUS="fail"
fi

echo "Starting instrumentation companion ${INSTRUMENTATION_TARGET} on port ${TOUCH_PORT}"
adb -s "$SERIAL" forward "tcp:${TOUCH_PORT}" "tcp:${TOUCH_PORT}"
adb -s "$SERIAL" shell am instrument -w "$INSTRUMENTATION_TARGET" >"$INSTRUMENTATION_LOG" 2>&1 &
INSTRUMENTATION_PID="$!"
wait_for_instrumentation

if run_backend instrumentation npx playwright test "${SPECS[@]}"; then
  INSTRUMENTATION_STATUS="pass"
else
  INSTRUMENTATION_STATUS="fail"
fi

[[ "$CLI_STATUS" == "pass" ]] || fail "cli backend e2e run failed"
[[ "$INSTRUMENTATION_STATUS" == "pass" ]] || fail "instrumentation backend e2e run failed"

echo "PASS: Android cli and instrumentation backend e2e smoke passed"
