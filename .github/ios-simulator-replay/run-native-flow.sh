#!/usr/bin/env bash
set -euo pipefail
MAESTRO="$1"
SIM_ID="$2"
CASE_DIR="$3"
FLOW="$4"
XCTESTRUN="$5"
test "$(uname -s)" = Darwin
test -f "$XCTESTRUN"
CLI_PID=''
DRIVER_PID=''
cleanup_driver() {
  if [ -n "$CLI_PID" ]; then kill "$CLI_PID" 2>/dev/null || true; wait "$CLI_PID" 2>/dev/null || true; fi
  if [ -n "$DRIVER_PID" ]; then kill "$DRIVER_PID" 2>/dev/null || true; wait "$DRIVER_PID" 2>/dev/null || true; fi
  xcrun simctl terminate "$SIM_ID" dev.mobile.maestro-driver-iosUITests.xctrunner 2>/dev/null || true
}
trap cleanup_driver EXIT
PORT=$(node -e 'const n=require("node:net"),s=n.createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
printf '%s\n' "$PORT" > "$CASE_DIR/native-driver-port.txt"
# cli-2.11.0 TestCommand requires its chosen port to be free. Start CLI first,
# then wait for the documented installer handshake before launching XCTest.
USE_XCODE_TEST_RUNNER=1 "$MAESTRO" --verbose --device "$SIM_ID" --driver-host-port "$PORT" \
  test --format JUNIT --output "$CASE_DIR/junit.xml" --test-output-dir "$CASE_DIR" \
  --debug-output "$CASE_DIR/maestro-debug" "$FLOW" > "$CASE_DIR/maestro.log" 2>&1 &
CLI_PID=$!
READY=0
for attempt in {1..300}; do
  if grep -F -q 'USE_XCODE_TEST_RUNNER is set. Will wait for XCTest runner to be started manually' "$CASE_DIR/maestro.log"; then READY=1; break; fi
  if ! kill -0 "$CLI_PID" 2>/dev/null; then set +e; wait "$CLI_PID"; code=$?; set -e; CLI_PID=''; if [ "$code" = 0 ]; then code=1; fi; exit "$code"; fi
  sleep 0.1
done
test "$READY" = 1
TEST_RUNNER_PORT="$PORT" xcodebuild test-without-building \
  -xctestrun "$XCTESTRUN" -destination "id=$SIM_ID" \
  -derivedDataPath "$CASE_DIR/xctest-launch" \
  -resultBundlePath "$CASE_DIR/native-driver.xcresult" \
  > "$CASE_DIR/native-driver.log" 2>&1 &
DRIVER_PID=$!
printf '%s\n' "$DRIVER_PID" > "$CASE_DIR/native-driver-process.txt"
set +e
wait "$CLI_PID"
FLOW_EXIT=$?
CLI_PID=''
# No login replay or automatic test retry. A driver failure remains an explicit
# failed case with original logs; only the next independent case proceeds.
if kill -0 "$DRIVER_PID" 2>/dev/null && curl --fail --silent --max-time 3 "http://127.0.0.1:$PORT/status" > "$CASE_DIR/native-driver-status.json"; then
  USE_XCODE_TEST_RUNNER=1 "$MAESTRO" --device "$SIM_ID" --driver-host-port "$PORT" hierarchy \
    > "$CASE_DIR/final-hierarchy.txt" 2>&1
else
  printf '%s\n' 'Custom XCTest driver unavailable; no stock fallback or flow replay.' > "$CASE_DIR/final-hierarchy.txt"
fi
set -e
if [ "$FLOW_EXIT" = 0 ]; then
  grep -F -q 'sideout-native-proof: Safari hierarchy disabled' "$CASE_DIR/native-driver.log"
  if grep -F -q 'Fetch Safari WebView hierarchy - start' "$CASE_DIR/native-driver.log"; then
    echo 'Unexpected stock Safari hierarchy enrichment in native-only driver' >&2
    exit 1
  fi
fi
exit "$FLOW_EXIT"
