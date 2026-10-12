#!/usr/bin/env bash
set -euo pipefail
TASK_DIR=$(cd "$(dirname "$0")" && pwd)
SOURCE_DIR=$(cd "$1" && pwd)
EVIDENCE_DIR="$2"
mkdir -p "$EVIDENCE_DIR"
EVIDENCE_DIR=$(cd "$EVIDENCE_DIR" && pwd)
export SOURCE_DIR EVIDENCE_DIR
test "$(uname -s)" = Darwin
test "${SOURCE_SHA:-}" = eb504d5b3ee7f3068d34c9c6be5fd31e1909b3f8
test "$(git -C "$SOURCE_DIR" rev-parse HEAD)" = "$SOURCE_SHA"
test -z "$(git -C "$SOURCE_DIR" status --porcelain)"
node "$TASK_DIR/verify-proposal.cjs" --integrity
cmp "$TASK_DIR/ios-simulator-proof.yml" "$TASK_DIR/../workflows/ios-simulator-proof.yml"
date -u +%Y-%m-%dT%H:%M:%SZ > "$EVIDENCE_DIR/started-at.txt"
git -C "$SOURCE_DIR" rev-parse HEAD > "$EVIDENCE_DIR/source-commit.txt"
printf '%s\n' "${GITHUB_SHA:-not-github}" > "$EVIDENCE_DIR/proof-assets-commit.txt"

XCODE_APP=$(find /Applications -maxdepth 1 -name 'Xcode_26*.app' -type d | sort -V | tail -1)
test -n "$XCODE_APP"
sudo xcode-select -s "$XCODE_APP/Contents/Developer"
xcodebuild -version > "$EVIDENCE_DIR/xcode-version.txt"
node --version > "$EVIDENCE_DIR/node-version.txt"
java -version 2> "$EVIDENCE_DIR/java-version.txt"

# Use the actual available iOS runtime. Require the requested phone definition;
# failure preserves inventory and cannot silently substitute a different class.
xcrun simctl list --json > "$EVIDENCE_DIR/simulator-inventory.json"
node "$TASK_DIR/simulator-metadata.cjs" select "$EVIDENCE_DIR"
SIM_RUNTIME=$(node -p "require(process.argv[1]).runtime.identifier" "$EVIDENCE_DIR/simulator-selection.json")
SIM_TYPE=$(node -p "require(process.argv[1]).deviceType.identifier" "$EVIDENCE_DIR/simulator-selection.json")
SIM_ID=$(xcrun simctl create "sideout-auth-${GITHUB_RUN_ID:-local}-eb504d5" "$SIM_TYPE" "$SIM_RUNTIME")
printf '%s\n' "$SIM_ID" > "$EVIDENCE_DIR/simulator-id.txt"
printf 'SIDEOUT_SIMULATOR_ID=%s\n' "$SIM_ID" >> "$GITHUB_ENV"
export SIM_ID
xcrun simctl boot "$SIM_ID"
xcrun simctl bootstatus "$SIM_ID" -b
xcrun simctl ui "$SIM_ID" appearance dark

cd "$SOURCE_DIR"
npm ci > "$EVIDENCE_DIR/npm-ci.log" 2>&1
npx expo config --type public --json > "$RUNNER_TEMP/sideout-public-config.json"
node "$TASK_DIR/simulator-metadata.cjs" config "$RUNNER_TEMP/sideout-public-config.json" "$EVIDENCE_DIR"
npx expo prebuild --platform ios --no-install > "$EVIDENCE_DIR/prebuild.log" 2>&1
(cd ios && pod install --repo-update) > "$EVIDENCE_DIR/pods.log" 2>&1
# Prebuild only creates the disposable Xcode project. Refuse unexpected changes
# to the shipped application code, entry, config or dependency lock.
git diff --exit-code -- App.tsx index.js app.config.ts src plugins package.json package-lock.json
WORKSPACE=$(find "$SOURCE_DIR/ios" -maxdepth 1 -name '*.xcworkspace' -type d)
test -n "$WORKSPACE"
test "$(printf '%s\n' "$WORKSPACE" | wc -l | tr -d ' ')" = 1
SCHEME=$(basename "$WORKSPACE" .xcworkspace)
DERIVED="$RUNNER_TEMP/sideout-simulator-derived"
xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Release \
  -sdk iphonesimulator -destination "id=$SIM_ID" -derivedDataPath "$DERIVED" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= DEVELOPMENT_TEAM= \
  build > "$EVIDENCE_DIR/xcodebuild.log" 2>&1
APP_PATH=$(find "$DERIVED/Build/Products/Release-iphonesimulator" -maxdepth 1 -name '*.app' -type d)
test -n "$APP_PATH"
test "$(printf '%s\n' "$APP_PATH" | wc -l | tr -d ' ')" = 1
export APP_PATH
node "$TASK_DIR/simulator-metadata.cjs" app "$APP_PATH" "$EVIDENCE_DIR"
xcrun simctl install "$SIM_ID" "$APP_PATH"

# Official CLI 2.11.0 asset, release digest read from GitHub on 2026-10-12.
# Download an immutable, verified archive instead of executing a moving installer.
MAESTRO_DIR="$RUNNER_TEMP/sideout-maestro-2.11.0"
mkdir -p "$MAESTRO_DIR"
curl --fail --location --silent --show-error \
  https://github.com/mobile-dev-inc/Maestro/releases/download/cli-2.11.0/maestro.zip \
  --output "$MAESTRO_DIR/maestro.zip"
printf '%s  %s\n' 5384593cb4e7a106489e75a821d157dd43f4e438df6bc308b72e82c685e1283a "$MAESTRO_DIR/maestro.zip" | shasum -a 256 -c -
unzip -q "$MAESTRO_DIR/maestro.zip" -d "$MAESTRO_DIR"
MAESTRO="$MAESTRO_DIR/maestro/bin/maestro"
test -f "$MAESTRO"
chmod +x "$MAESTRO"
"$MAESTRO" --version > "$EVIDENCE_DIR/maestro-version.txt"
set +e
"$MAESTRO" --device "$SIM_ID" test --format JUNIT \
  --output "$EVIDENCE_DIR/junit.xml" --test-output-dir "$EVIDENCE_DIR" \
  --debug-output "$EVIDENCE_DIR/maestro-debug" \
  -e "EVIDENCE_DIR=$EVIDENCE_DIR" "$TASK_DIR/auth-town.yaml" \
  > "$EVIDENCE_DIR/maestro.log" 2>&1
FLOW_EXIT=$?
"$MAESTRO" --device "$SIM_ID" hierarchy > "$EVIDENCE_DIR/final-hierarchy.txt" 2>&1
xcrun simctl io "$SIM_ID" screenshot "$EVIDENCE_DIR/final-screen.png"
set -e
export FLOW_EXIT
node "$TASK_DIR/simulator-metadata.cjs" finish "$EVIDENCE_DIR"
exit "$FLOW_EXIT"
