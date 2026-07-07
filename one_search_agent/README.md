# One Search Vulnerability Assistant - Agent Backend

A LangGraph agent exposing natural-language vulnerability search over
AG-UI's SSE protocol, backed by the `vulnerability_mcp` MCP server
(connected over stdio - see `../vulnerability_mcp/`).

The dashboard (KPI cards, charts, filter panel, results table,
download link) is built deterministically in Python from each turn's
actual tool results (`agent.py`'s `_build_dashboard`) and streamed to
the frontend via AG-UI's standard state-sync mechanism - no LLM call,
no generative-UI step.

## Declarative UI rendering (`ui_spec`/`ui_data`)

Every turn additionally gets a generic, renderer-agnostic description
under the `ui_spec`/`ui_data` state keys, built the same deterministic
way as `dashboard` (see `_build_ui_data`/`_build_ui_spec`) and synced
alongside it - it's purely additive, `dashboard` is unchanged.

- **`ui_data`** is a registry of this turn's MCP tool results, copied
  VERBATIM and keyed by tool name (e.g. `get_vulnerability_summary`) -
  never reshaped, aggregated, or rewritten, plus a synthetic
  `_filters` entry (filter field definitions + this turn's applied
  values, same derivation `_build_dashboard` already does).
- **`ui_spec`** is a grid layout (rows of display elements) plus an
  elements list. Each element has a `type` of `chart`, `table`,
  `markdown`, `kpi`, `download`, or `input_form`. Every non-markdown
  element carries a `dataRef` - a dotted path into `ui_data` (e.g.
  `"get_vulnerability_summary.breakdowns.severity_breakdown"`) -
  instead of any embedded values; the frontend resolves the path and
  binds the real tool data straight to the element (see
  `one_search_ui/src/declarative/`). Only `markdown` elements carry
  free text, since they're the one type without a trust claim about
  exactly matching the underlying numbers.

### Hybrid composer (`COMPOSER_MODE`)

How `ui_spec`'s elements get *chosen and arranged* from `ui_data` is a
hybrid, set via `COMPOSER_MODE` (see `composers.py`). The DATA always
flows only by `dataRef` regardless of mode - the choice is purely
about presentation:

- `deterministic` (default) - an ordered, extensible registry of
  per-slice composer functions (`DETERMINISTIC_COMPOSERS`). No LLM,
  fully reliable. Adding support for a new tool = appending one
  composer function.
- `llm` - a schema-constrained model call (`COMPOSER_MODEL`) picks and
  arranges elements every turn. It's handed the exact menu of bindable
  `dataRef` paths and each element's `dataRef` is validated to resolve
  before acceptance, so it can only choose presentation, never alter
  or invent data. Any failure falls back to the deterministic registry
  for that turn.
- `hybrid` - deterministic first; the LLM only composes for tool
  outputs the registry doesn't cover yet (the extension path).

Which of `dashboard` or `ui_spec`/`ui_data` actually renders is a
frontend choice (`one_search_ui`'s `VITE_UI_RENDER_MODE`, default
`dashboard`) - the backend always computes and sends both.

## Access & the session-start welcome

Vulnerability queries are scoped per-user by a trusted `X-Employee-Id`
header (see "Access control" below and `../vulnerability_mcp`'s access
model). When a fresh conversation opens, the frontend sends a hidden
`[UI_ACTION session_start]` message; the agent calls `get_user_access`
+ `get_vulnerability_summary` and returns a welcome that summarizes the
user's access (owned apps, owned infrastructure, delegated access, and
admin status) plus their scoped vulnerability breakdown, then invites
them to hone in on a specific space.

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
VULN_MCP_PROJECT_DIR=/absolute/path/to/claud-playground
PYTHON_BIN=python3

# Optional - display-element composer (see "Hybrid composer" above).
COMPOSER_MODE=deterministic   # deterministic (default) | llm | hybrid
# COMPOSER_MODEL=openai/gpt-4o-mini   # defaults to OPENROUTER_MODEL
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
