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
stop_owned_process() {
  local pid="$1"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    for attempt in {1..50}; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; fi
  fi
  if wait "$pid"; then STOPPED_EXIT=0; else STOPPED_EXIT=$?; fi
}
wait_for_cli_start() {
  local started=$SECONDS deadline=$((SECONDS + $1))
  local next_report=0 elapsed=0
  READY=0
  STARTUP_REASON='handshake-timeout'
  STARTUP_EXIT=null
  STARTUP_PHASE='cli-initializing'
  while [ "$SECONDS" -lt "$deadline" ]; do
    elapsed=$((SECONDS - started))
    if [ "$elapsed" -ge "$next_report" ]; then
      if grep -F -q 'Selected device' "$CASE_DIR/maestro.log"; then STARTUP_PHASE='device-selected';
      elif grep -F -q 'Using SLF4J' "$CASE_DIR/maestro.log"; then STARTUP_PHASE='after-jvm-log'; fi
      printf 'phase=%s elapsedSeconds=%s timeoutSeconds=%s\n' "$STARTUP_PHASE" "$elapsed" "$1" | tee -a "$CASE_DIR/native-driver-startup-phases.log"
      next_report=$((elapsed + 5))
    fi
    if ! kill -0 "$CLI_PID" 2>/dev/null; then
      if wait "$CLI_PID"; then STARTUP_EXIT=0; else STARTUP_EXIT=$?; fi
      CLI_PID=''
      STARTUP_REASON='cli-exited-before-handshake'
      break
    fi
    if grep -F -q 'USE_XCODE_TEST_RUNNER is set. Will wait for XCTest runner to be started manually' "$CASE_DIR/maestro.log"; then
      READY=1
      STARTUP_REASON='handshake-ready'
      STARTUP_PHASE='manual-runner-handshake'
      break
    fi
    sleep 0.2
  done
  if [ "$READY" = 0 ] && [ -n "$CLI_PID" ]; then
    stop_owned_process "$CLI_PID"
    STARTUP_EXIT=$STOPPED_EXIT
    CLI_PID=''
  fi
  printf 'phase=%s reason=%s elapsedSeconds=%s timeoutSeconds=%s\n' "$STARTUP_PHASE" "$STARTUP_REASON" "$((SECONDS - started))" "$1" | tee -a "$CASE_DIR/native-driver-startup-phases.log"
  printf '{"phase":"%s","reason":"%s","ready":%s,"cliExit":%s,"elapsedSeconds":%s,"timeoutSeconds":%s,"driverStarted":false}\n' \
    "$STARTUP_PHASE" "$STARTUP_REASON" "$READY" "$STARTUP_EXIT" "$((SECONDS - started))" "$1" > "$CASE_DIR/native-driver-startup.json"
  [ "$READY" = 1 ]
}
supervise_flow() {
  local started=$SECONDS next_report=0 readiness_limit=${3:-120}
  READINESS_REQUIRED=false
  DRIVER_READY=null
  if [ "${2:-none}" = ready ]; then READINESS_REQUIRED=true; DRIVER_READY=false; fi
  SUPERVISION_REASON='cli-exited'
  DRIVER_EXIT=null
  CLI_STOPPED=false
  while :; do
    # Fail closed if the owned test server ends before its CLI result is collected.
    if ! kill -0 "$DRIVER_PID" 2>/dev/null; then
      wait "$DRIVER_PID"
      DRIVER_EXIT=$?
      DRIVER_PID=''
      SUPERVISION_REASON='driver-exited-before-cli-result'
      if kill -0 "$CLI_PID" 2>/dev/null; then
        CLI_STOPPED=true
      fi
      stop_owned_process "$CLI_PID"
      CLI_EXIT=$STOPPED_EXIT
      CLI_PID=''
      FLOW_EXIT=70
      break
    fi
    if [ "$READINESS_REQUIRED" = true ] && [ "$DRIVER_READY" = false ]; then
      if curl --fail --silent --connect-timeout 1 --max-time 1 "http://127.0.0.1:$PORT/status" > "$CASE_DIR/native-driver-ready.json.tmp"; then
        mv "$CASE_DIR/native-driver-ready.json.tmp" "$CASE_DIR/native-driver-ready.json"
        DRIVER_READY=true
        printf 'phase=driver-ready elapsedSeconds=%s\n' "$((SECONDS - started))" | tee -a "$CASE_DIR/native-driver-readiness-phases.log"
      elif [ "$((SECONDS - started))" -ge "$readiness_limit" ]; then
        SUPERVISION_REASON='driver-readiness-timeout'
        CLI_STOPPED=true
        stop_owned_process "$CLI_PID"; CLI_EXIT=$STOPPED_EXIT; CLI_PID=''
        stop_owned_process "$DRIVER_PID"; DRIVER_EXIT=$STOPPED_EXIT; DRIVER_PID=''
        FLOW_EXIT=70
        break
      elif [ "$((SECONDS - started))" -ge "$next_report" ]; then
        printf 'phase=waiting-driver-status elapsedSeconds=%s timeoutSeconds=%s\n' "$((SECONDS - started))" "$readiness_limit" | tee -a "$CASE_DIR/native-driver-readiness-phases.log"
        next_report=$((SECONDS - started + 5))
      fi
    fi
    if ! kill -0 "$CLI_PID" 2>/dev/null; then
      wait "$CLI_PID"
      CLI_EXIT=$?
      FLOW_EXIT=$CLI_EXIT
      CLI_PID=''
      if [ "$FLOW_EXIT" = 0 ] && [ "$DRIVER_READY" = false ]; then SUPERVISION_REASON='cli-exited-before-driver-ready'; FLOW_EXIT=70; fi
      break
    fi
    sleep 0.1
  done
  printf '{"reason":"%s","flowExit":%s,"driverExit":%s,"cliExit":%s,"cliStopped":%s,"readinessRequired":%s,"readyObserved":%s,"elapsedSeconds":%s,"readinessTimeoutSeconds":%s}\n' \
    "$SUPERVISION_REASON" "$FLOW_EXIT" "$DRIVER_EXIT" "$CLI_EXIT" "$CLI_STOPPED" "$READINESS_REQUIRED" "$DRIVER_READY" "$((SECONDS - started))" "$readiness_limit" > "${1:-$CASE_DIR/native-driver-supervision.json}"
}
cleanup_driver() {
  if [ -n "$CLI_PID" ]; then stop_owned_process "$CLI_PID"; fi
  if [ -n "$DRIVER_PID" ]; then stop_owned_process "$DRIVER_PID"; fi
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
# Initialization bound matches pinned LocalXCTestInstaller SERVER_LAUNCH_TIMEOUT_MS=120000.
# This is a harness deadline, not a Maestro environment override.
if ! wait_for_cli_start 120; then exit 70; fi
TEST_RUNNER_PORT="$PORT" xcodebuild test-without-building \
  -xctestrun "$XCTESTRUN" -destination "id=$SIM_ID" \
  -derivedDataPath "$CASE_DIR/xctest-launch" \
  -resultBundlePath "$CASE_DIR/native-driver.xcresult" \
  > "$CASE_DIR/native-driver.log" 2>&1 &
DRIVER_PID=$!
printf '%s\n' "$DRIVER_PID" > "$CASE_DIR/native-driver-process.txt"
set +e
supervise_flow "$CASE_DIR/native-driver-supervision.json" ready 120
# No login replay or automatic test retry. A driver failure remains an explicit
# failed case with original logs; only the next independent case proceeds.
if kill -0 "$DRIVER_PID" 2>/dev/null && curl --fail --silent --max-time 3 "http://127.0.0.1:$PORT/status" > "$CASE_DIR/native-driver-status.json"; then
  USE_XCODE_TEST_RUNNER=1 "$MAESTRO" --device "$SIM_ID" --driver-host-port "$PORT" hierarchy \
    > "$CASE_DIR/final-hierarchy.txt" 2>&1 &
  CLI_PID=$!
  MAIN_FLOW_EXIT=$FLOW_EXIT
  supervise_flow "$CASE_DIR/native-driver-hierarchy-supervision.json"
  if [ "$MAIN_FLOW_EXIT" != 0 ]; then FLOW_EXIT=$MAIN_FLOW_EXIT; fi
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
