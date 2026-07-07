# A2UI Vulnerability Assistant - Frontend

React + TypeScript + Vite frontend that renders **agent-generated UI**
using the real [a2ui.org](https://a2ui.org) React renderer
(`@a2ui/react` + `@a2ui/web_core`), driven over AG-UI's SSE protocol by
the `../a2ui_agent` backend.

Unlike `../one_search_ui` (which renders a fixed dashboard / declarative
spec the backend fills with data), here the **agent's LLM authors the
entire component tree** each turn; this app just processes the resulting
a2ui.org messages and renders them.

## How it works

1. `src/agent.ts` - a shared `@ag-ui/client` `HttpAgent` pointed at the
   backend, sending the dev identity as an `X-Employee-Id` header.
2. Each turn, the backend streams an a2ui.org v0.9 message list
   (`createSurface` + `updateComponents`) on the AG-UI state key
   `a2ui_messages`.
3. `src/a2ui/A2UISurface.tsx` feeds those messages into a real
   `@a2ui/web_core` `MessageProcessor` and renders the surface with
   `@a2ui/react`'s `A2uiSurface`.
4. `src/a2ui/catalog.tsx` is a thin assembler: it imports each custom
   visualization's a2ui implementation and registers them alongside
   a2ui's shipped `basicCatalog`. Each visualization lives in its own
   file under `src/a2ui/` and exports its `*Implementation`:
   `Chart.tsx`, `Kpi.tsx`, `Markdown.tsx`, `Download.tsx`, `Table.tsx`
   (interactive: sort/paginate/CSV), `Filter.tsx` (interactive). Its
   `CATALOG_ID` must match `a2ui_agent/a2ui_schema.py`.

### Data trust badges (`TrustBadge.tsx`)

Every data-bearing visualization shows a trust badge. When the backend
bound the data by REFERENCE to verbatim MCP tool output (see
`a2ui_agent`'s `dataRef`/`valueRef`), the component arrives with
`trusted: true` and renders a green **"Trusted data"** shield. When the
LLM had to supply the numbers inline (no reference fit), it arrives
`trusted: false` and renders a muted **"AI-generated"** tag - so the
absence of the trust mark is always explicit, never ambiguous. Tables
(rows injected from the records tool) are always trusted; markdown is
narration and carries no badge.

The **backend composes a row-based layout** and Python compiles it into
this component tree (see `a2ui_agent/README.md`) - so the agent picks
the rows/content while placement rules (table/download/filter each get
their own row) and data injection happen deterministically.

The `Filter` panel is interactive: its Apply button calls the
`ApplyFilters` callback from `src/a2ui/ApplyFiltersContext.ts`, which
`App.tsx` wires to send a `[UI_ACTION apply_filters]` refinement to the
agent (the raw payload is hidden; a short summary bubble is shown).

## Setup & running

```bash
npm install
npm run dev -- --port 5176
```

Open **http://localhost:5176**. Requires the `../a2ui_agent` backend on
port 8004 and `vulnerability_mcp`'s download API on port 8000.

## Environment (`.env`)

```env
VITE_AGUI_URL=http://localhost:8004/agui
VITE_DEV_EMPLOYEE_ID=E100000     # simulates the Okta gateway's X-Employee-Id
```

`VITE_DEV_EMPLOYEE_ID` pins the signed-in identity (the gateway would
inject `X-Employee-Id` in production); it scopes every query to that
user's access. Run `python -m vulnerability_mcp.seed_data` for demo
ECNs. On load, the app sends a hidden `[UI_ACTION session_start]` so the
agent greets the user with an access summary + vulnerability breakdown.

## Building

```bash
npm run build
```
