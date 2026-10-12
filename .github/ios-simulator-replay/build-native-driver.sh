#!/usr/bin/env bash
set -euo pipefail
TASK_DIR=$(cd "$(dirname "$0")" && pwd)
SOURCE_DIR=$(cd "$1" && pwd)
EVIDENCE_DIR=$(cd "$2" && pwd)
test "$(uname -s)" = Darwin
test "$(git -C "$SOURCE_DIR" rev-parse HEAD)" = c8c361be1cc89b2e742f185466a302a22778be6b
BUILD_DIR="$RUNNER_TEMP/sideout-maestro-native-only-build"
test ! -e "$BUILD_DIR"
PATCHED=0
restore_source() {
  if [ "$PATCHED" = 1 ]; then node "$TASK_DIR/prepare-native-driver.cjs" restore "$SOURCE_DIR" "$EVIDENCE_DIR"; fi
}
trap restore_source EXIT
node "$TASK_DIR/prepare-native-driver.cjs" prepare "$SOURCE_DIR" "$EVIDENCE_DIR"
PATCHED=1
# Same Simulator project/scheme/build-for-testing contract as pinned upstream.
# Only the XCTest instrumentation is compiled; sideout.app is never an input.
xcodebuild build-for-testing \
  -project "$SOURCE_DIR/maestro-ios-xctest-runner/maestro-driver-ios.xcodeproj" \
  -scheme maestro-driver-ios \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$BUILD_DIR" \
  -onlyUsePackageVersionsFromResolvedFile \
  ARCHS="$(uname -m)" DEVELOPMENT_TEAM= CODE_SIGN_IDENTITY=- \
  > "$EVIDENCE_DIR/native-driver-build.log" 2>&1
node "$TASK_DIR/prepare-native-driver.cjs" capture "$SOURCE_DIR" "$EVIDENCE_DIR" "$BUILD_DIR/Build/Products"
node "$TASK_DIR/prepare-native-driver.cjs" restore "$SOURCE_DIR" "$EVIDENCE_DIR"
PATCHED=0
