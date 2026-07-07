#!/usr/bin/env bash
# Runs the full stack: MCP downloads API (:8000), agent API (:8001), React UI (:5173).
# Usage: ./scripts/run_local.sh          (from the repo root)
# Stop everything with Ctrl+C.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# --- 1. Agent venv + deps -------------------------------------------------
cd "$ROOT/vuln_agent"
if [ ! -d .venv ]; then python3 -m venv .venv; fi
source .venv/bin/activate
pip install -q -r requirements.txt

if [ ! -f .env ]; then
  echo "ERROR: vuln_agent/.env missing. Copy .env.example and set OPENROUTER_API_KEY." >&2
  exit 1
fi
set -a; source .env; set +a
export VULN_MCP_PROJECT_DIR="${VULN_MCP_PROJECT_DIR:-$ROOT}"
# The agent venv has all MCP-server deps, so use it for the stdio subprocess.
export PYTHON_BIN="${PYTHON_BIN_OVERRIDE:-$ROOT/vuln_agent/.venv/bin/python}"

# --- 2. Seed MCP data if needed (sqlite db is CWD-relative -> repo root) ---
cd "$ROOT"
if [ ! -f "$ROOT/vulnerabilities.db" ]; then
  echo "Seeding sample data..."
  "$ROOT/vuln_agent/.venv/bin/python" -m vulnerability_mcp.seed_data || true
fi

# --- 3. Start services ----------------------------------------------------
PIDS=()
cleanup() { echo; echo "Stopping..."; kill "${PIDS[@]}" 2>/dev/null || true; }
trap cleanup EXIT

echo "[1/3] MCP downloads API -> http://localhost:8000"
"$ROOT/vuln_agent/.venv/bin/uvicorn" vulnerability_mcp.api:app --port 8000 &
PIDS+=($!)

echo "[2/3] Agent API (REST /chat + AG-UI /agui) -> http://localhost:8001"
(cd "$ROOT/vuln_agent" && .venv/bin/uvicorn vuln_agent.api:app --port 8001) &
PIDS+=($!)

echo "[3/3] React UI -> http://localhost:5173"
cd "$ROOT/vuln_ui"
[ -d node_modules ] || npm install
npm run dev &
PIDS+=($!)

wait
