# One Search Vulnerability Assistant

A natural-language vulnerability search assistant: a Python/LangGraph
agent backend, a React/AG-UI frontend, and a shared vulnerability data
MCP server, all running as sibling projects under this directory.

```
claud-playground/
├── vulnerability_mcp/    # Shared vulnerability data layer + MCP server + download API
├── one_search_agent/     # LangGraph agent backend (AG-UI protocol, port 8003)
├── one_search_ui/        # React/Vite frontend + Node conversation/lookup APIs (port 5175)
└── vulnerabilities.db    # Local SQLite DB (created by seed_data.py)
```

## Prerequisites

- Python 3.11+
- Node.js 22+ (the frontend's data-source layer uses the built-in `node:sqlite` module)

## 1. Seed the local database

No virtualenv needed for this step - it's Python stdlib only.

```bash
cd claud-playground
python3 -m vulnerability_mcp.seed_data
```

Creates `vulnerabilities.db` in this directory (5,000 sample
vulnerabilities + application/user reference tables). Safe to re-run -
skips if data already exists; delete `vulnerabilities.db` first for a
clean reseed.

## 2. Start the MCP server

```bash
cd claud-playground/vulnerability_mcp
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd ..
python -m vulnerability_mcp.server
```

This speaks MCP's stdio/JSON-RPC protocol - it has no HTTP port and
will just sit there waiting for a client to talk to it on stdin/stdout
(that's expected, not a hang). Use this command when pointing a
**generic** MCP client (Claude Desktop, Claude Code, the MCP
Inspector) at this server directly - see `vulnerability_mcp/README.md`
for a sample client config.

**For this project's own agent**, you don't run this command yourself
at all - skip straight to step 4 below. `one_search_agent` spawns
`python -m vulnerability_mcp.server` itself as a stdio subprocess each
time *it* starts (using the same venv set up above), so there's
nothing separate to keep running for that path.

## 3. Start the download API (port 8000)

Serves the CSV export files referenced by `get_vulnerability_summary`'s
`download_url`. Separate from the MCP server above, since that one
speaks stdio/JSON-RPC to whatever spawns it, while this just needs to
be reachable over HTTP. Uses the same venv from step 2.

```bash
cd claud-playground
source vulnerability_mcp/.venv/bin/activate
uvicorn vulnerability_mcp.api:app --host 0.0.0.0 --port 8000
```

Verify: `curl http://localhost:8000/health` → `{"status":"ok"}`.

## 4. Start the agent backend (port 8003)

```bash
cd claud-playground/one_search_agent
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Create `one_search_agent/.env`:

```env
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_A2UI_MODEL=openai/gpt-4o-mini
VULN_MCP_PROJECT_DIR=/absolute/path/to/claud-playground
PYTHON_BIN=python3
```

Run it:

```bash
uvicorn server:app --host 0.0.0.0 --port 8003
```

Verify: `curl http://localhost:8003/health` → `{"status":"ok"}`.

## 5. Start the frontend (port 5175)

```bash
cd claud-playground/one_search_ui
npm install
npm run dev -- --port 5175
```

One command starts Vite **and** the Node middleware APIs (conversation
history CRUD, application/owner lookups for the searchable filter
dropdowns) baked into the same dev-server process - look for
`[conversations-api] mounted...` / `[entity-api] mounted...` in the
log. Defaults to reading the local SQLite file with zero config.

Open **http://localhost:5175**.

## Run order

Seed (once) → download API → agent backend → frontend. Only the
**download API**, **agent backend**, and **frontend** need to be kept
running simultaneously for the app to work end-to-end - the MCP server
(step 2) is only run standalone if you're pointing a generic MCP
client at it; `one_search_agent` spawns its own copy automatically.

## Restarting a service

```bash
# Download API
pkill -f "uvicorn vulnerability_mcp.api:app --host 0.0.0.0 --port 8000"
cd claud-playground && source vulnerability_mcp/.venv/bin/activate && uvicorn vulnerability_mcp.api:app --host 0.0.0.0 --port 8000 &

# Agent backend
pkill -f "uvicorn server:app --host 0.0.0.0 --port 8003"
cd claud-playground/one_search_agent && source .venv/bin/activate && uvicorn server:app --host 0.0.0.0 --port 8003 &

# Frontend
pkill -f "vite --port 5175"
cd claud-playground/one_search_ui && npm run dev -- --port 5175 &
```

## Switching data backends

Both the Python MCP server and the Node frontend APIs can point at
SQLite (default, zero config), Postgres, SQL Server, or Starburst -
independently per resource. See:

- `vulnerability_mcp/README.md` - `VULN_MCP_DB_BACKEND` and the
  `postgres_*`/`sqlserver_*`/`starburst_*` settings.
- `one_search_ui/README.md` - `CONVERSATIONS_BACKEND` /
  `APPLICATIONS_BACKEND` / `USERS_BACKEND`.

## Access control

An Okta-validating gateway in front of this app can forward a trusted
`X-Employee-Id` header on requests to the agent backend; when present,
`vulnerability_mcp` restricts results to vulnerabilities for
applications that employee owns. See `one_search_agent/identity.py`
and `vulnerability_mcp/repository/vulnerability_repository.py`'s
access-control clause. Omitting the header returns unrestricted
results (the default for local dev).

## Testing

```bash
cd claud-playground
pytest vulnerability_mcp/tests -q
```

(If a conflicting globally-installed pytest plugin causes import
errors, try `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest -p pytester -p asyncio vulnerability_mcp/tests -q` instead.)
