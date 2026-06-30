# One Search Vulnerability Assistant - Frontend

React + TypeScript + Vite frontend for the One Search Vulnerability
Assistant, talking to the agent backend (`../one_search_agent/`, port
8003) over AG-UI's SSE protocol via `@ag-ui/client`'s `HttpAgent`.

A Vite dev-server middleware plugin (`server/`) also exposes a real
Node.js API for conversation management and filter-dropdown lookups -
mounted into the *same* process as `npm run dev`, no separate process
to start.

## Dashboard rendering: `dashboard` vs declarative (`src/declarative/`)

The agent backend sends two parallel descriptions of the same turn's
results every time (see `../one_search_agent/README.md`'s
"Declarative UI rendering" section): the original `dashboard` state
field (rendered by `src/dashboard/Dashboard.tsx`) and a new generic
`ui_spec`/`ui_data` pair (rendered by
`src/declarative/DeclarativeDashboard.tsx`). Which one this build
actually renders is controlled by `.env`'s `VITE_UI_RENDER_MODE`
(`dashboard` default, or `declarative`) - this is a pure frontend
switch, the backend always sends both regardless.

The declarative renderer is type-driven: each component in
`ui_spec.components` is one of `chart`/`table`/`markdown`/
`input_form`, and `chart`/`table`/`input_form` components carry a
`dataRef` (a dotted path like
`"get_vulnerability_summary.breakdowns.severity_breakdown"`) instead
of any embedded data - `src/declarative/resolveDataRef.ts` resolves
the path against `ui_data` and binds the result straight into the
existing `Chart`/`Table`/`FilterPanel` components (no new chart/table
widgets were built - the declarative layer is a different way of
*addressing* the same trusted data into the same renderers). Only
`markdown` components carry free text.

## Setup

```bash
npm install
```

## Running

```bash
npm run dev -- --port 5175
```

Starts Vite **and** the Node middleware APIs together - look for
`[conversations-api] mounted...` / `[entity-api] mounted...` in the
log. Open **http://localhost:5175**.

Requires the agent backend (`../one_search_agent/`) running on port
8003 - see its own README, or the root `README.md` for the full
multi-service startup sequence.

## The Node APIs (`server/`)

| Endpoint | Backs |
|---|---|
| `GET/POST/PATCH/DELETE /api/conversations[/:id]` | The left-nav conversation list (create/rename/delete/list) |
| `GET /api/applications` | The searchable Application filter dropdown |
| `GET /api/users` | The searchable Owner filter dropdown |

Each of `conversations`/`applications`/`users` independently picks its
own backend via an env var, defaulting to SQLite (zero config, reads
the same `vulnerabilities.db` the Python side uses):

| Resource | Backend var | Values |
|---|---|---|
| Conversations | `CONVERSATIONS_BACKEND` | `sqlite` (default), `postgres`, `sqlserver`, `starburst` |
| Applications | `APPLICATIONS_BACKEND` | `sqlite` (default), `postgres`, `sqlserver`, `starburst` |
| Users | `USERS_BACKEND` | `sqlite` (default), `postgres`, `sqlserver`, `starburst` |

Each non-sqlite backend needs its own connection settings (e.g.
`CONVERSATIONS_PG_HOST`/`_PORT`/`_DATABASE`/`_USER`/`_PASSWORD`/`_TABLE`
for Postgres - see `server/dataSources/config.ts` for the full set per
backend). The real table/column names for Postgres/SQL Server/Starburst
are **placeholders** marked `// TODO` in `server/dataSources/postgres.ts`
/`sqlserver.ts`/`starburst.ts` - edit those before pointing a resource
at a non-sqlite backend.

Conversation message *content* (the actual chat transcript, as opposed
to the id/name/timestamp metadata above) lives in the browser's
`localStorage`, keyed by conversation id - not in any of these
backends.

## Building

```bash
npm run build
```

## Restarting the dev server

```bash
pkill -f "vite --port 5175"
npm run dev -- --port 5175 &
```
