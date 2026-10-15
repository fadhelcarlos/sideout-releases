#!/usr/bin/env bash
set -euo pipefail
TASK_DIR=$(cd "$(dirname "$0")" && pwd)
EVIDENCE_DIR="$1"
test "$(uname -s)" = Darwin
test ! -e "$EVIDENCE_DIR"
mkdir -p "$EVIDENCE_DIR"
EVIDENCE_DIR=$(cd "$EVIDENCE_DIR" && pwd)
node "$TASK_DIR/capture-evidence.cjs" retrieve "$EVIDENCE_DIR"
XCODE_APP=$(find /Applications -maxdepth 1 -name 'Xcode_26*.app' -type d | sort -V | tail -1)
test -n "$XCODE_APP"
sudo xcode-select -s "$XCODE_APP/Contents/Developer"
xcodebuild -version > "$EVIDENCE_DIR/xcode-version.txt"
xcrun simctl list --json > "$EVIDENCE_DIR/simulator-inventory.json"
node "$TASK_DIR/capture-evidence.cjs" select "$EVIDENCE_DIR"
SIM_RUNTIME=$(node -p 'require(process.argv[1]).runtime' "$EVIDENCE_DIR/simulator-selection.json")
SIM_TYPE=$(node -p 'require(process.argv[1]).deviceType' "$EVIDENCE_DIR/simulator-selection.json")
SIM_ID=$(xcrun simctl create "sideout-native-screenshots-$GITHUB_RUN_ID" "$SIM_TYPE" "$SIM_RUNTIME")
printf '%s\n' "$SIM_ID" > "$EVIDENCE_DIR/simulator-id.txt"
BACKEND_PID=''; BROKER_PID=''
cleanup() {
  for pid in "$BACKEND_PID" "$BROKER_PID"; do
    if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  done
  xcrun simctl shutdown "$SIM_ID" 2>/dev/null || true
}
trap cleanup EXIT
xcrun simctl boot "$SIM_ID"
xcrun simctl bootstatus "$SIM_ID" -b
xcrun simctl ui "$SIM_ID" appearance dark
# Screenshots remain unmodified native system output, including the actual status bar.
xcrun simctl io "$SIM_ID" screenshot "$EVIDENCE_DIR/runtime-before.png"
node -e 'require(process.argv[1]).png(process.argv[2])' "$TASK_DIR/capture-evidence.cjs" "$EVIDENCE_DIR/runtime-before.png"
APP_PATH=$(find "$EVIDENCE_DIR/app" -maxdepth 1 -name '*.app' -type d)
test "$(printf '%s\n' "$APP_PATH" | wc -l | tr -d ' ')" = 1
node "$TASK_DIR/metadata.cjs" app "$APP_PATH" "$EVIDENCE_DIR"
node "$TASK_DIR/capture-evidence.cjs" verifyApp "$EVIDENCE_DIR"
xcrun simctl install "$SIM_ID" "$APP_PATH"
node "$TASK_DIR/backend.cjs" serve "$EVIDENCE_DIR" > "$EVIDENCE_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
node "$TASK_DIR/capture-evidence.cjs" serve "$EVIDENCE_DIR" > "$EVIDENCE_DIR/capture-broker.log" 2>&1 &
BROKER_PID=$!
for attempt in {1..20}; do
  kill -0 "$BACKEND_PID"; kill -0 "$BROKER_PID"
  if curl --fail --silent http://127.0.0.1:8787/health > "$EVIDENCE_DIR/backend-health.json" && curl --fail --silent http://127.0.0.1:8788/health > "$EVIDENCE_DIR/broker-health.txt"; then break; fi
  sleep 1
done
test -s "$EVIDENCE_DIR/backend-health.json"
MAESTRO_DIR="$RUNNER_TEMP/sideout-screenshot-maestro-2.11.0"
mkdir "$MAESTRO_DIR"
curl --fail --location --silent --show-error https://github.com/mobile-dev-inc/Maestro/releases/download/cli-2.11.0/maestro.zip --output "$MAESTRO_DIR/maestro.zip"
printf '%s  %s\n' 5384593cb4e7a106489e75a821d157dd43f4e438df6bc308b72e82c685e1283a "$MAESTRO_DIR/maestro.zip" | shasum -a 256 -c -
unzip -q "$MAESTRO_DIR/maestro.zip" -d "$MAESTRO_DIR"
MAESTRO="$MAESTRO_DIR/maestro/bin/maestro"
chmod +x "$MAESTRO"
"$MAESTRO" --version > "$EVIDENCE_DIR/maestro-version.txt"
REPLAY="$TASK_DIR/../ios-simulator-replay"
node "$REPLAY/record-stock-driver.cjs" preserve "$MAESTRO_DIR/maestro/lib" "$EVIDENCE_DIR"
bash "$REPLAY/build-native-driver.sh" "$GITHUB_WORKSPACE/maestro-native" "$EVIDENCE_DIR"
XCTESTRUN=$(cat "$EVIDENCE_DIR/native-driver-xctestrun.txt")
mkdir "$EVIDENCE_DIR/navigation"
set +e
bash "$REPLAY/run-native-flow.sh" "$MAESTRO" "$SIM_ID" "$EVIDENCE_DIR/navigation" "$TASK_DIR/screenshots.yaml" "$XCTESTRUN"
FLOW_EXIT=$?
set -e
printf '%s\n' "$FLOW_EXIT" > "$EVIDENCE_DIR/navigation/exit-code.txt"
xcrun simctl io "$SIM_ID" screenshot "$EVIDENCE_DIR/final-screen.png"
node "$REPLAY/record-stock-driver.cjs" verify "$MAESTRO_DIR/maestro/lib" "$EVIDENCE_DIR"
test "$FLOW_EXIT" = 0
node "$TASK_DIR/capture-evidence.cjs" finish "$EVIDENCE_DIR"
