# One Search Vulnerability Assistant - Agent Backend

A LangGraph agent exposing natural-language vulnerability search over
AG-UI's SSE protocol, backed by the `vulnerability_mcp` MCP server
(connected over stdio - see `../vulnerability_mcp/`).

The dashboard (KPI cards, charts, filter panel, results table,
download link) is built deterministically in Python from each turn's
actual tool results (`agent.py`'s `_build_dashboard`) and streamed to
the frontend via AG-UI's standard state-sync mechanism - no LLM call,
no generative-UI step.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Create a `.env` file in this directory:

```env
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_A2UI_MODEL=openai/gpt-4o-mini
VULN_MCP_PROJECT_DIR=/absolute/path/to/claud-playground
PYTHON_BIN=python3
```

`VULN_MCP_PROJECT_DIR` must point at the directory that *contains*
`vulnerability_mcp/` (the project root, one level up from here) - this
agent spawns `python -m vulnerability_mcp.server` as a stdio
subprocess with that as its working directory.

## Running

```bash
uvicorn server:app --host 0.0.0.0 --port 8003
```

Verify: `curl http://localhost:8003/health` → `{"status":"ok"}`.

This single process:
- Serves AG-UI's SSE protocol at `POST /agui` (the frontend's only
  integration point - there's no separate REST chat endpoint).
- Spawns the `vulnerability_mcp` MCP server itself over stdio on
  startup - nothing else needs to be running for that part.

Also needs (run separately, see the root `README.md`):
- `vulnerability_mcp`'s download API (port 8000) - serves the CSV
  export links the dashboard's download button points at.
- `one_search_ui` (port 5175) - the frontend that actually talks to
  this backend.

## Access control

If an Okta-validating gateway sits in front of this service and
forwards a trusted `X-Employee-Id` header, this backend reads it
(`identity.py`) and injects it into every vulnerability-query MCP tool
call deterministically - the LLM never sees or controls this
parameter (see `agent.py`'s `_with_injected_identity`). Omitting the
header (the default for local dev) returns unrestricted results. See
`../vulnerability_mcp/README.md` for what the identity actually
restricts once it reaches the MCP server.

## Restarting

```bash
pkill -f "uvicorn server:app --host 0.0.0.0 --port 8003"
uvicorn server:app --host 0.0.0.0 --port 8003 &
```
