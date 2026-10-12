#!/usr/bin/env bash
set -euo pipefail
TASK_DIR=$(cd "$(dirname "$0")" && pwd)
EVIDENCE_DIR=$(cd "$1" && pwd)
ORIGINAL="$TASK_DIR/../ios-simulator-proof"
test "$(uname -s)" = Darwin
node "$TASK_DIR/download.cjs" --integrity
export SOURCE_SHA=eeceb6b3c8caa77841b78ab693a468dc6e2d84d5
phase() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" | tee -a "$EVIDENCE_DIR/phases.log"; }
phase cached-app-prepare
XCODE_APP=$(find /Applications -maxdepth 1 -name 'Xcode_26*.app' -type d | sort -V | tail -1)
test -n "$XCODE_APP"
sudo xcode-select -s "$XCODE_APP/Contents/Developer"
xcodebuild -version > "$EVIDENCE_DIR/xcode-version.txt"
xcrun simctl list --json > "$EVIDENCE_DIR/simulator-inventory.json"
node "$TASK_DIR/proof.cjs" select "$EVIDENCE_DIR"
SIM_RUNTIME=$(node -p 'require(process.argv[1]).simulator.runtime' "$TASK_DIR/manifest.json")
SIM_TYPE=$(node -p 'require(process.argv[1]).simulator.deviceType' "$TASK_DIR/manifest.json")
APP_ZIP="$EVIDENCE_DIR/inherited/simulator-app.zip"
printf '%s  %s\n' aeb9d8786aabd1e65239eaa7b1338d6ff38c106db6035746133ab1bd6d330e08 "$APP_ZIP" | shasum -a 256 -c -
test ! -e "$EVIDENCE_DIR/app"
mkdir "$EVIDENCE_DIR/app"
ditto -x -k "$APP_ZIP" "$EVIDENCE_DIR/app"
APP_PATH="$EVIDENCE_DIR/app/sideout.app"
test -d "$APP_PATH"
node "$ORIGINAL/simulator-metadata.cjs" app "$APP_PATH" "$EVIDENCE_DIR"
node "$TASK_DIR/proof.cjs" app "$EVIDENCE_DIR" "$APP_PATH"

MAESTRO_DIR="$RUNNER_TEMP/sideout-cached-maestro-2.11.0"
mkdir "$MAESTRO_DIR"
curl --fail --location --silent --show-error https://github.com/mobile-dev-inc/Maestro/releases/download/cli-2.11.0/maestro.zip --output "$MAESTRO_DIR/maestro.zip"
printf '%s  %s\n' 5384593cb4e7a106489e75a821d157dd43f4e438df6bc308b72e82c685e1283a "$MAESTRO_DIR/maestro.zip" | shasum -a 256 -c -
unzip -q "$MAESTRO_DIR/maestro.zip" -d "$MAESTRO_DIR"
MAESTRO="$MAESTRO_DIR/maestro/bin/maestro"
chmod +x "$MAESTRO"
"$MAESTRO" --version > "$EVIDENCE_DIR/maestro-version.txt"
node "$TASK_DIR/record-stock-driver.cjs" preserve "$MAESTRO_DIR/maestro/lib" "$EVIDENCE_DIR"
bash "$TASK_DIR/build-native-driver.sh" "$GITHUB_WORKSPACE/maestro-native" "$EVIDENCE_DIR"
XCTESTRUN=$(cat "$EVIDENCE_DIR/native-driver-xctestrun.txt")

# Each case gets a new Simulator and a new local backend state. A failed case
# returns its own status; the next case never inherits its app storage or draft.
run_case() (
  set -euo pipefail
  kind="$1"
  CASE_DIR="$EVIDENCE_DIR/$kind"
  mkdir "$CASE_DIR"
  phase "$kind-initialize"
  SIM_ID=$(xcrun simctl create "sideout-replay-${GITHUB_RUN_ID:-local}-$kind" "$SIM_TYPE" "$SIM_RUNTIME")
  printf '%s\n' "$SIM_ID" > "$CASE_DIR/simulator-id.txt"
  printf '%s\n' "$SIM_ID" >> "$EVIDENCE_DIR/simulator-ids.txt"
  LOCAL_BACKEND_PID=''
  cleanup_case() {
    if [ -n "$LOCAL_BACKEND_PID" ]; then kill "$LOCAL_BACKEND_PID" 2>/dev/null || true; wait "$LOCAL_BACKEND_PID" 2>/dev/null || true; fi
    xcrun simctl shutdown "$SIM_ID" 2>/dev/null || true
  }
  trap cleanup_case EXIT
  xcrun simctl boot "$SIM_ID"
  xcrun simctl bootstatus "$SIM_ID" -b
  xcrun simctl ui "$SIM_ID" appearance dark
  xcrun simctl io "$SIM_ID" screenshot "$CASE_DIR/runtime-before.png"
  node -e 'const fs=require("node:fs"),a=require("node:assert/strict"),b=fs.readFileSync(process.argv[1]);a.equal(b.toString("ascii",1,4),"PNG");a.equal(b.readUInt32BE(16),1206);a.equal(b.readUInt32BE(20),2622)' "$CASE_DIR/runtime-before.png"
  xcrun simctl install "$SIM_ID" "$APP_PATH"
  node "$TASK_DIR/case-backend.cjs" init "$kind" "$CASE_DIR"
  node "$TASK_DIR/case-backend.cjs" serve "$kind" "$CASE_DIR" > "$CASE_DIR/local-backend.log" 2>&1 &
  LOCAL_BACKEND_PID=$!
  for attempt in {1..20}; do
    kill -0 "$LOCAL_BACKEND_PID"
    if curl --fail --silent http://127.0.0.1:8787/health > "$CASE_DIR/local-health.json"; then break; fi
    sleep 1
  done
  kill -0 "$LOCAL_BACKEND_PID"
  node -e 'const a=require("node:assert/strict"),r=require(process.argv[1]);a.equal(r.kind,"sideout-isolated-ios-simulator-v1");a.equal(r.backend,"http://127.0.0.1:8787")' "$CASE_DIR/local-health.json"
  if [ "$kind" = copy ]; then printf '%s' sideout-local-copy-negative-control | xcrun simctl pbcopy "$SIM_ID"; fi
  phase "$kind-flow"
  set +e
  bash "$TASK_DIR/run-native-flow.sh" "$MAESTRO" "$SIM_ID" "$CASE_DIR" "$TASK_DIR/$kind.yaml" "$XCTESTRUN"
  FLOW_EXIT=$?
  if [ "$FLOW_EXIT" = 0 ]; then
    node "$TASK_DIR/case-backend.cjs" verify "$kind" "$CASE_DIR"
    FLOW_EXIT=$?
  fi
  if [ "$kind" = copy ] && [ "$FLOW_EXIT" = 0 ]; then
    xcrun simctl pbpaste "$SIM_ID" > "$CASE_DIR/share-pasteboard.txt"
    node "$ORIGINAL/simulator-metadata.cjs" clipboard "$CASE_DIR/share-pasteboard.txt" "$CASE_DIR"
    FLOW_EXIT=$?
  fi
  xcrun simctl io "$SIM_ID" screenshot "$CASE_DIR/final-screen.png"
  set -e
  exit "$FLOW_EXIT"
)
for kind in onboarding copy; do
  set +e
  run_case "$kind"
  result=$?
  set -e
  mkdir -p "$EVIDENCE_DIR/$kind"
  printf '%s\n' "$result" > "$EVIDENCE_DIR/$kind/exit-code.txt"
  phase "$kind-exit-$result"
done
node "$TASK_DIR/record-stock-driver.cjs" verify "$MAESTRO_DIR/maestro/lib" "$EVIDENCE_DIR"
node "$TASK_DIR/proof.cjs" finish "$EVIDENCE_DIR"
phase finished
