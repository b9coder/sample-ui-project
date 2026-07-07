#!/usr/bin/env bash
# End-to-end smoke test against a running stack (see run_local.sh).
# Checks: health endpoints, REST /chat display payload, AG-UI /agui SSE stream.
set -uo pipefail
AGENT=http://localhost:8001
DOWNLOADS=http://localhost:8000
PASS=0; FAIL=0

check() { # name, condition-exit-code
  if [ "$2" -eq 0 ]; then echo "PASS  $1"; PASS=$((PASS+1)); else echo "FAIL  $1"; FAIL=$((FAIL+1)); fi
}

curl -sf "$DOWNLOADS/health" >/dev/null; check "downloads API /health" $?
curl -sf "$AGENT/health" >/dev/null;    check "agent API /health" $?
curl -sf "$AGENT/schema" | grep -q '"DisplayPayload"'; check "agent /schema serves contract" $?

echo "--- REST /chat (may take ~10-30s: LLM + tool calls) ---"
CHAT=$(curl -sf -X POST "$AGENT/chat" -H "Content-Type: application/json" \
  -d '{"message": "Give me a summary of all critical vulnerabilities"}')
echo "$CHAT" | grep -q '"rows"';           check "/chat returns rows" $?
echo "$CHAT" | grep -q '"type": *"chart"\|"type":"chart"'; check "/chat rows include a chart" $?
echo "$CHAT" | grep -q '"source"';         check "/chat meta.source present" $?

echo "--- AG-UI /agui (SSE) ---"
AGUI=$(curl -sf -N --max-time 120 -X POST "$AGENT/agui" \
  -H "Content-Type: application/json" -H "Accept: text/event-stream" \
  -d '{"threadId":"t-smoke","runId":"r-smoke","state":{},
       "messages":[{"id":"m1","role":"user","content":"Which applications are the riskiest?"}],
       "tools":[],"context":[],"forwardedProps":{}}')
echo "$AGUI" | grep -q 'RUN_STARTED';    check "AG-UI emits RUN_STARTED" $?
echo "$AGUI" | grep -q 'TOOL_CALL_START'; check "AG-UI emits tool call events" $?
echo "$AGUI" | grep -q 'display_rows';   check "AG-UI emits display_rows custom event" $?
echo "$AGUI" | grep -q 'RUN_FINISHED';   check "AG-UI emits RUN_FINISHED" $?

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
