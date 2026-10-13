#!/usr/bin/env bash
set -euo pipefail
TASK_DIR=$(cd "$(dirname "$0")" && pwd)
SOURCE_DIR=$(cd "$1" && pwd)
EVIDENCE_DIR="$2"
test ! -e "$EVIDENCE_DIR"
mkdir -p "$EVIDENCE_DIR"
EVIDENCE_DIR=$(cd "$EVIDENCE_DIR" && pwd)
export SOURCE_DIR EVIDENCE_DIR
REPLAY="$TASK_DIR/../ios-simulator-replay"
ORIGINAL="$TASK_DIR/../ios-simulator-proof"
test "$(uname -s)" = Darwin
node "$TASK_DIR/verify.cjs" source "$SOURCE_DIR"
date -u +%Y-%m-%dT%H:%M:%SZ > "$EVIDENCE_DIR/started-at.txt"
printf '%s\n' "$SOURCE_SHA" > "$EVIDENCE_DIR/source-commit.txt"
printf '%s\n' "$GITHUB_SHA" > "$EVIDENCE_DIR/proof-assets-commit.txt"
cp "$TASK_DIR/manifest.json" "$EVIDENCE_DIR/proof-manifest.json"
phase() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" | tee -a "$EVIDENCE_DIR/phases.log"; }
phase fresh-app-prepare
XCODE_APP=$(find /Applications -maxdepth 1 -name 'Xcode_26*.app' -type d | sort -V | tail -1)
test -n "$XCODE_APP"
sudo xcode-select -s "$XCODE_APP/Contents/Developer"
xcodebuild -version > "$EVIDENCE_DIR/xcode-version.txt"
node --version > "$EVIDENCE_DIR/node-version.txt"
java -version 2> "$EVIDENCE_DIR/java-version.txt"
xcrun simctl list --json > "$EVIDENCE_DIR/simulator-inventory.json"
node "$TASK_DIR/proof.cjs" select "$EVIDENCE_DIR"
SIM_RUNTIME=$(node -p 'require(process.argv[1]).simulator.runtime' "$TASK_DIR/manifest.json")
SIM_TYPE=$(node -p 'require(process.argv[1]).simulator.deviceType' "$TASK_DIR/manifest.json")
SIM_ID=$(xcrun simctl create "sideout-build-10030-$GITHUB_RUN_ID" "$SIM_TYPE" "$SIM_RUNTIME")
printf '%s\n' "$SIM_ID" >> "$EVIDENCE_DIR/simulator-ids.txt"
trap 'xcrun simctl shutdown "$SIM_ID" 2>/dev/null || true' EXIT
xcrun simctl boot "$SIM_ID"
xcrun simctl bootstatus "$SIM_ID" -b
xcrun simctl ui "$SIM_ID" appearance dark
cd "$SOURCE_DIR"
phase npm-ci
npm ci > "$EVIDENCE_DIR/npm-ci.log" 2>&1
npx expo config --type public --json > "$RUNNER_TEMP/sideout-public-config.json"
node "$TASK_DIR/metadata.cjs" config "$RUNNER_TEMP/sideout-public-config.json" "$EVIDENCE_DIR"
npx expo prebuild --platform ios --no-install > "$EVIDENCE_DIR/prebuild.log" 2>&1
INFO_PLIST=$(find "$SOURCE_DIR/ios" -mindepth 2 -maxdepth 2 -name Info.plist -type f)
test "$(printf '%s\n' "$INFO_PLIST" | wc -l | tr -d ' ')" = 1
node "$TASK_DIR/metadata.cjs" ats "$INFO_PLIST" "$EVIDENCE_DIR"
phase pods
(cd ios && pod install --repo-update) > "$EVIDENCE_DIR/pods.log" 2>&1
# Prebuild only creates the disposable Xcode project. Refuse unexpected changes
# to the shipped application code, entry, config or dependency lock.
git diff --exit-code -- App.tsx index.js app.config.ts src plugins package.json package-lock.json
WORKSPACE=$(find "$SOURCE_DIR/ios" -maxdepth 1 -name '*.xcworkspace' -type d)
test -n "$WORKSPACE"
test "$(printf '%s\n' "$WORKSPACE" | wc -l | tr -d ' ')" = 1
SCHEME=$(basename "$WORKSPACE" .xcworkspace)
DERIVED="$RUNNER_TEMP/sideout-fresh-10030-derived"
test ! -e "$DERIVED"
phase xcode-build
xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Release \
  -sdk iphonesimulator -destination "id=$SIM_ID" -derivedDataPath "$DERIVED" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= DEVELOPMENT_TEAM= \
  build > "$EVIDENCE_DIR/xcodebuild.log" 2>&1
APP_PATH=$(find "$DERIVED/Build/Products/Release-iphonesimulator" -maxdepth 1 -name '*.app' -type d)
test -n "$APP_PATH"
test "$(printf '%s\n' "$APP_PATH" | wc -l | tr -d ' ')" = 1
export APP_PATH
node "$TASK_DIR/metadata.cjs" app "$APP_PATH" "$EVIDENCE_DIR"
# Retain this unsigned, local-backend app for separately reviewed UI-only replays.
# The existing evidence artifact carries its source/bundle hashes and archive digest.
phase preserve-simulator-app
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$EVIDENCE_DIR/simulator-app.zip"
(cd "$EVIDENCE_DIR" && shasum -a 256 simulator-app.zip > simulator-app.zip.sha256)
node "$TASK_DIR/proof.cjs" app "$EVIDENCE_DIR" "$APP_PATH"
xcrun simctl shutdown "$SIM_ID"
trap - EXIT

MAESTRO_DIR="$RUNNER_TEMP/sideout-cached-maestro-2.11.0"
mkdir "$MAESTRO_DIR"
curl --fail --location --silent --show-error https://github.com/mobile-dev-inc/Maestro/releases/download/cli-2.11.0/maestro.zip --output "$MAESTRO_DIR/maestro.zip"
printf '%s  %s\n' 5384593cb4e7a106489e75a821d157dd43f4e438df6bc308b72e82c685e1283a "$MAESTRO_DIR/maestro.zip" | shasum -a 256 -c -
unzip -q "$MAESTRO_DIR/maestro.zip" -d "$MAESTRO_DIR"
MAESTRO="$MAESTRO_DIR/maestro/bin/maestro"
chmod +x "$MAESTRO"
"$MAESTRO" --version > "$EVIDENCE_DIR/maestro-version.txt"
node "$REPLAY/record-stock-driver.cjs" preserve "$MAESTRO_DIR/maestro/lib" "$EVIDENCE_DIR"
bash "$REPLAY/build-native-driver.sh" "$GITHUB_WORKSPACE/maestro-native" "$EVIDENCE_DIR"
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
  node "$REPLAY/case-backend.cjs" init "$kind" "$CASE_DIR"
  node "$REPLAY/case-backend.cjs" serve "$kind" "$CASE_DIR" > "$CASE_DIR/local-backend.log" 2>&1 &
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
  bash "$REPLAY/run-native-flow.sh" "$MAESTRO" "$SIM_ID" "$CASE_DIR" "$TASK_DIR/$kind.yaml" "$XCTESTRUN"
  FLOW_EXIT=$?
  if [ "$FLOW_EXIT" = 0 ]; then
    node "$REPLAY/case-backend.cjs" verify "$kind" "$CASE_DIR"
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
node "$REPLAY/record-stock-driver.cjs" verify "$MAESTRO_DIR/maestro/lib" "$EVIDENCE_DIR"
node "$TASK_DIR/proof.cjs" finish "$EVIDENCE_DIR"
phase finished
