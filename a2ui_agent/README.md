# A2UI Vulnerability Assistant - Agent Backend

A clean-room, **A2UI-first** counterpart to `../one_search_agent`. It
reuses the same (unmodified) `vulnerability_mcp` MCP server for all data,
but instead of a deterministic dashboard it has the LLM **generate** the
on-screen UI as an [a2ui.org](https://a2ui.org) component tree - the
canonical "agent generates the interface" A2UI use case - streamed to
the frontend over AG-UI and rendered by the real `@a2ui/react` library.

## How a turn works

Two model calls per turn, by design:

1. A **ReAct agent** (`build_llm`) calls the `vulnerability_mcp` MCP
   tools and writes a short text reply.
2. A second **structured-output call** (`build_a2ui_llm`) produces a
   **row-based layout** (`layout.py`'s `Layout`): an ordered list of
   rows, each holding one or more typed display elements
   (`markdown` / `kpi` / `chart` / `table` / `download` / `filter`).
   The LLM only chooses the rows and their content - it does NOT
   hand-build the a2ui component tree.

Python then **deterministically compiles** that layout into the a2ui.org
component tree (`layout.py`'s `compile_layout`):

- **Placement rules enforced:** `markdown`/`kpi`/`chart` may share a
  row; `table`, `download`, and `filter` are each split into their own
  full-width row and never combined with other content.
- **Data bound by reference (trust):** for a `chart`/`kpi` the LLM
  provides a `dataRef`/`valueRef` - a dotted path into the trusted tool
  results (e.g.
  `get_vulnerability_summary.breakdowns.severity_breakdown`). Python
  resolves it and binds the REAL data, so what renders is the verbatim
  MCP output, not numbers the LLM retyped. Such visuals are marked
  `trusted: true` and the UI shows a **"Trusted data"** badge. If no
  path fits, the LLM may supply inline data instead - that visual is
  `trusted: false` and the UI shows an **"AI-generated"** badge. The
  agent is handed the exact list of bindable paths each turn
  (`bindable_paths`), so it references rather than guesses.
- **Table/download/filter injected:** table rows from
  `get_vulnerability_records`, download URL from the summary export,
  filter fields/current values from code - always trusted, LLM never
  restates them.
- **Valid by construction:** Python emits the ids and references, so
  there are no dangling child refs (the old "[Loading…]" placeholders
  are impossible), correct row weights, and rules guaranteed.

The compiled component list is wrapped into a2ui.org v0.9 wire messages
(`createSurface` + `updateComponents`, see `a2ui_schema.py`) and
attached to the LangGraph state's `a2ui_messages` key; AG-UI's
`STATE_SNAPSHOT` streams it to the frontend. If generation fails or
produces nothing renderable, the key is left null and the frontend keeps
its previous surface.

The frontend catalog (`a2ui_ui/src/a2ui/catalog.tsx`) registers a2ui's
`basicCatalog` plus custom `Chart`, `Kpi`, `DownloadLink`, `Markdown`,
`Table`, and `Filter` components (a2ui ships none of these). The
`filter` element is interactive - Apply round-trips a
`[UI_ACTION apply_filters]` message back to this agent, which the
SYSTEM_PROMPT handles by re-querying with the merged filters.

## Shared catalog manifest (the UI ↔ agent contract)

The set of supported elements, their placement rules, trust references,
and data bindings are **not hard-coded here** - they come from the
`catalog.manifest.json` the UI project generates and owns (see
`a2ui_ui`'s "shared catalog manifest"). This lets a UI developer add
layouts and a Python developer build the agent as independent projects.

- `catalog_manifest.py` loads the manifest (from the sibling `a2ui_ui/`
  by default; override with `A2UI_CATALOG_MANIFEST`). A future increment
  can instead receive it over AG-UI via A2UI client capabilities - the
  parsing stays the same.
- `compile_layout` (in `layout.py`) reads each element's `placement`
  (solo vs combinable), `dataRefProps` (trust), `dataBinding`, and
  target `component` name **from the manifest** - nothing element-
  specific is hard-coded in the compiler.
- `data_providers.py` is the agent-owned half: a registry mapping each
  `dataBinding` name (e.g. `vulnerability_records`, `summary_export`,
  `filter_schema`) to a function that pulls that trusted dataset from the
  turn's tool output. A new trusted data source = one provider here.
- `check_manifest_consistency()` runs at startup and logs (non-fatally)
  any drift - e.g. the manifest advertising an element the agent can't
  emit yet, or a `dataBinding` with no registered provider.

The boundary: a **presentation-only** element the UI adds needs no agent
change beyond its Pydantic model (a documented next step is generating
those from the manifest too); a **new trusted data source** needs a
one-line `data_providers.py` entry. Keep the manifest's `catalogId` in
sync with `a2ui_schema.py`'s `CATALOG_ID`.

## Access control

Vulnerability queries are scoped per-user by a trusted `X-Employee-Id`
header (injected by an Okta gateway; simulated in dev via the frontend's
`VITE_DEV_EMPLOYEE_ID`). Middleware reads it into a contextvar and the
tool wrapper injects it into every access-gated MCP call - the LLM never
sees or controls it. See `../vulnerability_mcp/README.md`'s "Access
model" for what the identity restricts.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

`.env` (in this directory):

```env
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
A2UI_MODEL=openai/gpt-4o-mini              # UI-generation model (optional)
VULN_MCP_PROJECT_DIR=/absolute/path/to/claud-playground
PYTHON_BIN=/abs/path/to/vulnerability_mcp/.venv/bin/python3
```

`VULN_MCP_PROJECT_DIR` must contain `vulnerability_mcp/` - this agent
spawns `python -m vulnerability_mcp.server` over stdio with that cwd,
using `PYTHON_BIN` (point it at the `vulnerability_mcp` venv so its deps
resolve). Seed the DB once from the project root:
`python -m vulnerability_mcp.seed_data`.

## Running

```bash
uvicorn server:app --host 0.0.0.0 --port 8004
```

Verify: `curl http://localhost:8004/health` → `{"status":"ok"}`.

Serves AG-UI's SSE protocol at `POST /agui` (the frontend's only
integration point) and spawns the MCP server itself. Also needs
`vulnerability_mcp`'s download API (port 8000, for CSV export links) and
the `a2ui_ui` frontend running. Runs alongside `one_search_agent`
(different port) without conflict - both reuse the same MCP server.

## Restarting

```bash
pkill -f "uvicorn server:app --host 0.0.0.0 --port 8004"
uvicorn server:app --host 0.0.0.0 --port 8004 &
```
