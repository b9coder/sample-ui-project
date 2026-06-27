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
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from agent import build_agent

_agent = None


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


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
