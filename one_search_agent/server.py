"""FastAPI wrapper around the One Search LangGraph agent.

Exposes the compiled agent graph over AG-UI's SSE protocol (the
frontend speaks to this server exclusively via @ag-ui/client's
HttpAgent - there is no separate custom REST chat endpoint in this
project, unlike vuln_agent/vuln_agent_agui).

Run with:
    uvicorn server:app --host 0.0.0.0 --port 8003
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from ag_ui_langgraph import LangGraphAgent, add_langgraph_fastapi_endpoint
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from agent import build_agent
from identity import EMPLOYEE_ID_HEADER, set_current_employee_id

_agent = None


class EmployeeIdentityMiddleware(BaseHTTPMiddleware):
    """Reads the trusted employee-identity header (set by an
    Okta-validating gateway in front of this service - see
    identity.py) into a per-request contextvar, so agent.py's tool
    wrapper can inject it into every vulnerability-query MCP tool call
    deterministically, without the LLM ever seeing or controlling it."""

    async def dispatch(self, request: Request, call_next):
        set_current_employee_id(request.headers.get(EMPLOYEE_ID_HEADER))
        return await call_next(request)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _agent
    _agent = await build_agent()
    add_langgraph_fastapi_endpoint(
        app,
        LangGraphAgent(
            name="one_search_vulnerability_agent",
            description=(
                "One Search Vulnerability Assistant - natural-language "
                "vulnerability search with an interactively-refinable, "
                "dynamically generated A2UI dashboard (KPI cards, charts, "
                "filter panel, results table, CSV export)."
            ),
            graph=_agent,
        ),
        path="/agui",
    )
    yield


app = FastAPI(title="One Search Vulnerability Agent", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(EmployeeIdentityMiddleware)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
