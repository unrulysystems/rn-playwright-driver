#!/usr/bin/env bash
set -euo pipefail

APP_SCHEME="${APP_SCHEME:-example}"
UITEST_SCHEME="${UITEST_SCHEME:-exampleUITests}"
APP_BUNDLE_ID="${APP_BUNDLE_ID:-com.unrulyfall.example}"
DEVICE_DESTINATION="${IOS_DESTINATION:-}"
TOUCH_PORT="${RN_TOUCH_XCTEST_PORT:-9999}"
TOUCH_AUTH_TOKEN="${RN_TOUCH_XCTEST_TOKEN:-}"
TOUCH_LAUNCH_MODE="${RN_TOUCH_XCTEST_LAUNCH:-launch}"
APP_LAUNCH_URL="${RN_TOUCH_XCTEST_APP_LAUNCH_URL:-}"
TOUCH_AUTH_TOKEN_FILE=""
TOUCH_CONFIG_FILE=""
METRO_HOST="${METRO_HOST:-127.0.0.1}"
METRO_PORT_EXPLICIT="${METRO_PORT:-}"
METRO_PORT="${METRO_PORT:-8081}"
METRO_URL="${RN_METRO_URL:-http://${METRO_HOST}:${METRO_PORT}}"
SPECS=(
  e2e/integration/counter.spec.ts
  e2e/pointer
  e2e/scroll/scroll.spec.ts
  e2e/primitives/touch-backend.spec.ts
)

METRO_PID=""
XCTEST_PID=""
STATUS="not-run"
METRO_LOG="$(mktemp -t rn-driver-ios-metro.XXXXXX.log)"
XCTEST_LOG="$(mktemp -t rn-driver-xctest.XXXXXX.log)"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

cleanup() {
  local exit_code=$?
  set +e

  if [[ -n "$XCTEST_PID" ]]; then
    kill "$XCTEST_PID" >/dev/null 2>&1
    wait "$XCTEST_PID" >/dev/null 2>&1
  fi

  if [[ -n "$METRO_PID" ]]; then
    kill "$METRO_PID" >/dev/null 2>&1
    wait "$METRO_PID" >/dev/null 2>&1
  fi

  echo "iOS XCTest e2e summary:"
  echo "  xctest: ${STATUS}"
  echo "  metro log: ${METRO_LOG}"
  echo "  xctest log: ${XCTEST_LOG}"

  if [[ -n "$TOUCH_AUTH_TOKEN_FILE" ]]; then
    rm -f "$TOUCH_AUTH_TOKEN_FILE"
  fi
  if [[ -n "$TOUCH_CONFIG_FILE" ]]; then
    rm -f "$TOUCH_CONFIG_FILE"
  fi

  exit "$exit_code"
}
trap cleanup EXIT

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

xcodebuild_clean() {
  # Generic Unix build environments often export LD=ld. Xcode treats LD as a
  # build setting and then passes clang-style -Xlinker flags to ld directly.
  env -u LD xcodebuild "$@"
}

select_ios_destination() {
  node <<'NODE'
const { execFileSync } = require('node:child_process')

const devicesJson = execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], {
  encoding: 'utf8',
})
const data = JSON.parse(devicesJson)
const devices = Object.entries(data.devices || {})
  .flatMap(([runtime, runtimeDevices]) =>
    runtimeDevices.map((device) => ({ ...device, runtime })),
  )
  .filter((device) => device.isAvailable !== false && device.name.startsWith('iPhone'))
  .map((device) => ({ ...device, runtimeVersion: runtimeVersion(device.runtime) }))

const byNewestRuntime = [...devices].sort((left, right) => {
  const versionDelta = compareRuntimeVersions(right.runtimeVersion, left.runtimeVersion)
  if (versionDelta !== 0) {
    return versionDelta
  }

  return preferredNameRank(left.name) - preferredNameRank(right.name)
})
const preferred = byNewestRuntime[0]

if (!preferred) {
  throw new Error('No available iPhone simulator found')
}

console.log(`platform=iOS Simulator,id=${preferred.udid}`)

function runtimeVersion(runtime) {
  const match = String(runtime).match(/iOS-([0-9-]+)$/)
  return match ? match[1].split('-').map((part) => Number.parseInt(part, 10)) : [0]
}

function compareRuntimeVersions(left, right) {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] || 0) - (right[index] || 0)
    if (delta !== 0) {
      return delta
    }
  }
  return 0
}

function preferredNameRank(name) {
  return ['iPhone 17', 'iPhone 17 Pro', 'iPhone 16', 'iPhone 16 Pro'].indexOf(name) === -1
    ? Number.MAX_SAFE_INTEGER
    : ['iPhone 17', 'iPhone 17 Pro', 'iPhone 16', 'iPhone 16 Pro'].indexOf(name)
}
NODE
}

configure_xctest_scheme_env() {
  local scheme_file="ios/${APP_SCHEME}.xcodeproj/xcshareddata/xcschemes/${UITEST_SCHEME}.xcscheme"
  [[ -f "$scheme_file" ]] || fail "XCTest scheme file not found: ${scheme_file}"

  RN_TOUCH_XCTEST_SCHEME_FILE="$scheme_file" \
    RN_TOUCH_XCTEST_CONFIG_FILE="$TOUCH_CONFIG_FILE" \
    node <<'NODE'
const fs = require('node:fs')

const schemeFile = process.env.RN_TOUCH_XCTEST_SCHEME_FILE
const configFile = process.env.RN_TOUCH_XCTEST_CONFIG_FILE
if (!schemeFile || !configFile) {
  throw new Error('RN_TOUCH_XCTEST_SCHEME_FILE and RN_TOUCH_XCTEST_CONFIG_FILE are required')
}

const escapedConfigFile = configFile
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
const variable = `         <EnvironmentVariable
            key = "RN_TOUCH_XCTEST_CONFIG_FILE"
            value = "${escapedConfigFile}"
            isEnabled = "YES">
         </EnvironmentVariable>`
let contents = fs.readFileSync(schemeFile, 'utf8')

if (contents.includes('key = "RN_TOUCH_XCTEST_CONFIG_FILE"')) {
  contents = contents.replace(
    /<EnvironmentVariable\s+key = "RN_TOUCH_XCTEST_CONFIG_FILE"\s+value = "[^"]*"\s+isEnabled = "YES">\s+<\/EnvironmentVariable>/,
    variable.trimStart(),
  )
} else if (contents.includes('<EnvironmentVariables>')) {
  contents = contents.replace(
    /(<EnvironmentVariables>\n)/,
    `$1${variable}\n`,
  )
} else {
  contents = contents.replace(
    /(<TestAction[\s\S]*?shouldUseLaunchSchemeArgsEnv = "YES">)/,
    `$1
      <EnvironmentVariables>
${variable}
      </EnvironmentVariables>`,
  )
}

fs.writeFileSync(schemeFile, contents)
NODE
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

destination_simulator_udid() {
  if [[ "$DEVICE_DESTINATION" =~ id=([^,]+) ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi

  return 1
}

configure_ios_packager_host() {
  local udid
  udid="$(destination_simulator_udid)" || fail "IOS_DESTINATION must include a simulator id, got: ${DEVICE_DESTINATION}"

  xcrun simctl boot "$udid" >/dev/null 2>&1 || true
  xcrun simctl bootstatus "$udid" -b

  # React Native reads these keys from the app's NSUserDefaults domain. Setting
  # them makes the example independent from the default compiled Metro port.
  xcrun simctl spawn "$udid" defaults write "$APP_BUNDLE_ID" RCT_jsLocation "${METRO_HOST}:${METRO_PORT}"
  xcrun simctl spawn "$udid" defaults write "$APP_BUNDLE_ID" RCT_packager_scheme "http"
}

wait_for_xctest() {
  for _ in {1..60}; do
    export RN_TOUCH_XCTEST_PROBE_PORT="$TOUCH_PORT"
    export RN_TOUCH_XCTEST_PROBE_TOKEN="$TOUCH_AUTH_TOKEN"
    if bun -e '
import WebSocket from "ws"

const port = process.env.RN_TOUCH_XCTEST_PROBE_PORT || "9999"
const authToken = process.env.RN_TOUCH_XCTEST_PROBE_TOKEN
const socket = new WebSocket("ws://127.0.0.1:" + port)
const timeout = setTimeout(() => {
  socket.close()
  process.exit(1)
}, 1000)

socket.once("open", () => {
  socket.send(
    JSON.stringify({
      id: 1,
      type: "hello",
      protocolVersion: 1,
      client: "rn-playwright-driver-e2e-probe",
      ...(authToken ? { authToken } : {}),
    }),
  )
})

socket.once("message", (data) => {
  clearTimeout(timeout)
  try {
    const payload = JSON.parse(String(data))
    process.exit(payload?.id === 1 && payload?.ok === true ? 0 : 1)
  } catch {
    process.exit(1)
  }
})

socket.once("error", () => {
  clearTimeout(timeout)
  process.exit(1)
})
' >/dev/null 2>&1; then
      unset RN_TOUCH_XCTEST_PROBE_PORT RN_TOUCH_XCTEST_PROBE_TOKEN
      return 0
    fi
    unset RN_TOUCH_XCTEST_PROBE_PORT RN_TOUCH_XCTEST_PROBE_TOKEN
    if ! kill -0 "$XCTEST_PID" >/dev/null 2>&1; then
      echo "XCTest companion exited before accepting connections" >&2
      tail -n 120 "$XCTEST_LOG" >&2 || true
      return 1
    fi
    sleep 1
  done

  echo "XCTest companion did not listen on 127.0.0.1:${TOUCH_PORT}" >&2
  tail -n 120 "$XCTEST_LOG" >&2 || true
  return 1
}

open_host_launch_url() {
  if [[ -z "$APP_LAUNCH_URL" ]]; then
    return 0
  fi

  local udid
  udid="$(destination_simulator_udid)" || fail "IOS_DESTINATION must include a simulator id, got: ${DEVICE_DESTINATION}"
  echo "Opening host launch URL for XCTest attach mode"
  xcrun simctl openurl "$udid" "$APP_LAUNCH_URL"
}

wait_for_hermes_target() {
  for _ in {1..45}; do
    if curl -fsS "${METRO_URL}/json" 2>/dev/null | grep -Eq 'Hermes|React Native'; then
      return 0
    fi
    sleep 1
  done

  echo "Hermes target did not appear at ${METRO_URL}/json" >&2
  echo "Metro /json response:" >&2
  curl -fsS "${METRO_URL}/json" >&2 || true
  echo >&2
  echo "Metro log tail:" >&2
  tail -n 80 "$METRO_LOG" >&2 || true
  echo "XCTest companion log tail:" >&2
  tail -n 80 "$XCTEST_LOG" >&2 || true
  return 1
}

require_command curl
require_command bun
require_command nc
require_command npx
require_command pod
require_command xcrun
require_command xcodebuild
select_metro_port
if [[ -z "$DEVICE_DESTINATION" ]]; then
  DEVICE_DESTINATION="$(select_ios_destination)"
fi
if [[ -z "$TOUCH_AUTH_TOKEN" ]]; then
  require_command openssl
  TOUCH_AUTH_TOKEN="$(openssl rand -hex 16)"
fi
TOUCH_AUTH_TOKEN_FILE="$(mktemp -t rn-driver-xctest-token.XXXXXX)"
chmod 600 "$TOUCH_AUTH_TOKEN_FILE"
printf '%s' "$TOUCH_AUTH_TOKEN" >"$TOUCH_AUTH_TOKEN_FILE"
TOUCH_CONFIG_FILE="${RN_TOUCH_XCTEST_CONFIG_FILE:-$(mktemp -t rn-driver-xctest-config.XXXXXX.json)}"
RN_TOUCH_XCTEST_CONFIG_FILE="$TOUCH_CONFIG_FILE" \
  RN_TOUCH_XCTEST_CONFIG_PORT="$TOUCH_PORT" \
  RN_TOUCH_XCTEST_CONFIG_TOKEN_FILE="$TOUCH_AUTH_TOKEN_FILE" \
  RN_TOUCH_XCTEST_CONFIG_LAUNCH="$TOUCH_LAUNCH_MODE" \
  node <<'NODE'
const fs = require('node:fs')

const configFile = process.env.RN_TOUCH_XCTEST_CONFIG_FILE
if (!configFile) {
  throw new Error('RN_TOUCH_XCTEST_CONFIG_FILE is required')
}

fs.writeFileSync(
  configFile,
  JSON.stringify({
    port: Number.parseInt(process.env.RN_TOUCH_XCTEST_CONFIG_PORT || '9999', 10),
    authTokenFile: process.env.RN_TOUCH_XCTEST_CONFIG_TOKEN_FILE,
    ...(process.env.RN_TOUCH_XCTEST_CONFIG_LAUNCH
      ? { launch: process.env.RN_TOUCH_XCTEST_CONFIG_LAUNCH }
      : {}),
  }),
)
fs.chmodSync(configFile, 0o600)
NODE

echo "Generating iOS project with Expo prebuild"
npx expo prebuild --platform ios --no-install
node ../../packages/xctest-companion/bin/scaffold.js --ios-dir ios --project-name "$APP_SCHEME"
cp "$TOUCH_CONFIG_FILE" "ios/${UITEST_SCHEME}/RNDriverTouchCompanionRuntimeConfig.json"
chmod 600 "ios/${UITEST_SCHEME}/RNDriverTouchCompanionRuntimeConfig.json"
configure_xctest_scheme_env
echo "Installing iOS pods"
pod install --project-directory=ios

if ! xcodebuild_clean -list -workspace "ios/${APP_SCHEME}.xcworkspace" 2>/dev/null | grep -Fq "$UITEST_SCHEME"; then
  fail "XCTest UI test scheme '${UITEST_SCHEME}' was not found after scaffold. Check the Expo plugin/scaffold output under ios/${APP_SCHEME}.xcodeproj."
fi

echo "Starting Metro at ${METRO_URL}"
CI=1 EXPO_NO_TELEMETRY=1 npx expo start --localhost --port "$METRO_PORT" >"$METRO_LOG" 2>&1 &
METRO_PID="$!"
wait_for_metro
configure_ios_packager_host

echo "Building app scheme ${APP_SCHEME}"
xcodebuild_clean build \
  -workspace "ios/${APP_SCHEME}.xcworkspace" \
  -scheme "$APP_SCHEME" \
  -destination "$DEVICE_DESTINATION" \
  RCT_METRO_PORT="$METRO_PORT"

echo "Starting XCTest companion scheme ${UITEST_SCHEME} on port ${TOUCH_PORT}"
RN_TOUCH_XCTEST_PORT="$TOUCH_PORT" \
  RN_TOUCH_XCTEST_CONFIG_FILE="$TOUCH_CONFIG_FILE" \
  RN_TOUCH_XCTEST_DEBUG="${RN_TOUCH_XCTEST_DEBUG:-}" \
  xcodebuild_clean test \
  -workspace "ios/${APP_SCHEME}.xcworkspace" \
  -scheme "$UITEST_SCHEME" \
  -destination "$DEVICE_DESTINATION" \
  -only-testing:"${UITEST_SCHEME}/RNDriverTouchCompanionTests/testRunServer" \
  RCT_METRO_PORT="$METRO_PORT" \
  >"$XCTEST_LOG" 2>&1 &
XCTEST_PID="$!"
wait_for_xctest
open_host_launch_url
wait_for_hermes_target

echo "Running iOS e2e with RN_TOUCH_BACKEND=xctest"
if RN_TOUCH_BACKEND=xctest \
  RN_TOUCH_XCTEST_PORT="$TOUCH_PORT" \
  RN_TOUCH_XCTEST_TOKEN_FILE="$TOUCH_AUTH_TOKEN_FILE" \
  RN_METRO_URL="$METRO_URL" \
  npx playwright test "${SPECS[@]}" --reporter=line; then
  STATUS="pass"
else
  STATUS="fail"
fi

[[ "$STATUS" == "pass" ]] || fail "xctest backend e2e run failed"

echo "PASS: iOS XCTest e2e passed"
