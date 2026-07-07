# Vulnerability Agent — display-element architecture

A LangGraph agent over the `vulnerability_mcp` server that answers questions and
returns a **renderable JSON payload** of display rows. The React UI (`../vuln_ui`)
renders the payload 1:1 — no layout logic on the client beyond the element components.

## Payload contract

Every `POST /chat` response is a `DisplayPayload`:

```json
{
  "message": "There are 42 critical vulnerabilities...",
  "rows": [
    {"id": "answer", "items": [{"element": {"type": "markdown", "content": "..."}, "span": 0}]},
    {"id": "summary-charts", "items": [
      {"element": {"type": "chart", "variant": "donut", "x_key": "name",
                   "data": [{"name": "critical", "count": 10}],
                   "series": [{"key": "count", "label": "Findings"}]}, "span": 0},
      {"element": {"type": "chart", "variant": "bar", "...": "..."}, "span": 0}
    ]},
    {"items": [{"element": {"type": "download", "file_name": "vulnerabilities_x.csv",
                             "url": "http://localhost:8000/downloads/...", "record_count": 42}}]},
    {"items": [{"element": {"type": "filter_panel", "fields": ["..."]}}]}
  ],
  "meta": {"source": "deterministic", "mode": "hybrid", "tools_used": ["get_vulnerability_summary"]}
}
```

Rows lay out on a 12-column grid; `span: 0` splits the row evenly.
Element types: `markdown`, `chart` (bar | line | area | pie | donut), `download`,
`filter_panel`, `table`, `stats`. Full schema: `GET /schema`
(source of truth: `vuln_agent/display/elements.py`).

## Hybrid element selection

```
agent turn ──> tool results ──> registered composer?  ──yes──> deterministic rows
                                      │ no
                                      ▼
                              LLM planner (schema-validated JSON, 1 repair retry)
                                      │ still invalid
                                      ▼
                              markdown-only fallback
```

- **Deterministic composers** (`display/composers.py`) map known tool outputs to
  rows: summary → stats + donut/bar charts + download + filter panel; risk ranking →
  horizontal bar + table; trend → line chart; records → table + filter panel.
- **LLM planner** (`display/llm_planner.py`) handles unknown tools / free-form
  answers. Its output is validated against the same Pydantic contract.
- **Presenter** (`display/presenter.py`) orchestrates. `PRESENTATION_MODE`
  env var: `hybrid` (default) | `deterministic` | `llm`.

## Extending

New element type:
1. Add a model in `display/elements.py` and add it to the `DisplayElement` union.
2. Add a React component and register it in `vuln_ui/src/components/elements/registry.js`.

New tool visualization:
```python
@register_composer("my_new_tool")
def compose_my_new_tool(output: dict, ctx: ComposeContext) -> list[DisplayRow]:
    return [row(MarkdownElement(content=...))]
```
No registration needed for LLM fallback — unknown tools automatically route there.

## AG-UI transport

The React app connects via the [AG-UI protocol](https://docs.ag-ui.com)
(`@ag-ui/client` `HttpAgent` → `POST /agui`, SSE). Events per run:

```
RUN_STARTED
TOOL_CALL_START/ARGS/END + TOOL_CALL_RESULT     (one set per MCP tool call)
TEXT_MESSAGE_START/CONTENT/END                  (assistant answer)
CUSTOM name="display_rows" value=DisplayPayload (what the UI renders)
RUN_FINISHED result=DisplayPayload              (RUN_ERROR on failure)
```

The `display_rows` custom event carries the exact same payload as REST
`POST /chat`, so both transports share one contract. Filter-panel
submissions travel as `forwardedProps.filters`. REST `/chat` remains for
curl/debugging. Implementation: `vuln_agent/agui.py` (the stream generator
is transport-pure and unit-tested in `tests/test_agui.py`).

## Running

Quickest: from the repo root

```bash
bash scripts/run_local.sh    # starts all three services, seeds sample data
bash scripts/smoke_test.sh   # end-to-end checks against the running stack
```

Manual:

```bash
# 1. MCP downloads API (serves CSV exports)
cd .. && uvicorn vulnerability_mcp.api:app --port 8000

# 2. Agent API (spawns the MCP server itself over stdio)
cd vuln_agent && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # set OPENROUTER_API_KEY
uvicorn vuln_agent.api:app --port 8001

# 3. UI
cd ../vuln_ui && npm install && npm run dev   # http://localhost:5173
```

## Tests

```bash
cd vuln_agent && python -m pytest
```

Covers: contract validation (discriminated union, bounds), every deterministic
composer, hybrid routing (deterministic skips LLM; LLM fallback; repair retry;
markdown fallback; mode overrides; filter-panel dedup; JSON serializability).
