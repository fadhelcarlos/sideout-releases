#!/usr/bin/env bash
set -euo pipefail
TASK_DIR=$(cd "$(dirname "$0")" && pwd)
SOURCE_DIR=$(cd "$1" && pwd)
EVIDENCE_DIR="$2"
test "$(uname -s)" = Darwin
test ! -e "$EVIDENCE_DIR"
mkdir -p "$EVIDENCE_DIR"
EVIDENCE_DIR=$(cd "$EVIDENCE_DIR" && pwd)
export SOURCE_DIR EVIDENCE_DIR
node "$TASK_DIR/verify.cjs" source "$SOURCE_DIR"
date -u +%Y-%m-%dT%H:%M:%SZ > "$EVIDENCE_DIR/started-at.txt"
printf '%s\n' "$SOURCE_SHA" > "$EVIDENCE_DIR/source-commit.txt"
printf '%s\n' "$GITHUB_SHA" > "$EVIDENCE_DIR/proof-assets-commit.txt"
cp "$TASK_DIR/manifest.json" "$EVIDENCE_DIR/source-manifest.json"
phase() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" | tee -a "$EVIDENCE_DIR/phases.log"; }
XCODE_APP=$(find /Applications -maxdepth 1 -name 'Xcode_26*.app' -type d | sort -V | tail -1)
test -n "$XCODE_APP"
sudo xcode-select -s "$XCODE_APP/Contents/Developer"
xcodebuild -version > "$EVIDENCE_DIR/xcode-version.txt"
xcrun simctl list --json > "$EVIDENCE_DIR/simulator-inventory.json"
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
git diff --exit-code > "$EVIDENCE_DIR/tracked-source-diff.txt"
WORKSPACE=$(find "$SOURCE_DIR/ios" -maxdepth 1 -name '*.xcworkspace' -type d)
test "$(printf '%s\n' "$WORKSPACE" | wc -l | tr -d ' ')" = 1
SCHEME=$(basename "$WORKSPACE" .xcworkspace)
DERIVED="$RUNNER_TEMP/sideout-screenshots-10031-derived"
test ! -e "$DERIVED"
phase xcode-build
xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Release \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath "$DERIVED" \
  ARCHS="$(uname -m)" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= DEVELOPMENT_TEAM= \
  build > "$EVIDENCE_DIR/xcodebuild.log" 2>&1
APP_PATH=$(find "$DERIVED/Build/Products/Release-iphonesimulator" -maxdepth 1 -name '*.app' -type d)
test "$(printf '%s\n' "$APP_PATH" | wc -l | tr -d ' ')" = 1
node "$TASK_DIR/metadata.cjs" app "$APP_PATH" "$EVIDENCE_DIR"
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$EVIDENCE_DIR/simulator-app.zip"
(cd "$EVIDENCE_DIR" && shasum -a 256 simulator-app.zip > simulator-app.zip.sha256)
git diff --exit-code > "$EVIDENCE_DIR/tracked-source-diff.txt"
phase build-complete
