"""FastAPI app exposing the agent as a chat endpoint that returns
display-element JSON.

Run with:
    uvicorn vuln_agent.api:app --port 8001 --reload

POST /chat {"message": "...", "history": [...], "filters": {...}}
  -> DisplayPayload {"message", "rows", "meta"}
GET /schema -> JSON schema of the payload (keeps UI/agent in sync)
"""
from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from typing import Any

from ag_ui.core import RunAgentInput
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .agent import build_agent, run_chat
from .agui import agui_event_stream
from .config import get_settings
from .display.elements import DisplayPayload, rows_json_schema
from .display.presenter import HybridPresenter, ToolResult

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

_state: dict[str, Any] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    agent, llm = await build_agent(settings)
    _state["agent"] = agent
    _state["presenter"] = HybridPresenter(llm=llm, mode=settings.presentation_mode)
    logger.info("Agent ready (presentation mode: %s)", settings.presentation_mode)
    yield
    _state.clear()


app = FastAPI(title="Vulnerability Agent", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten for production
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    history: list[dict[str, str]] = Field(default_factory=list)
    # Structured filters from the UI's filter panel; folded into the
    # user message so the agent applies them on its next tool call.
    filters: dict[str, Any] | None = None


@app.post("/chat", response_model=DisplayPayload)
async def chat(req: ChatRequest) -> DisplayPayload:
    agent = _state.get("agent")
    presenter: HybridPresenter | None = _state.get("presenter")
    if agent is None or presenter is None:
        raise HTTPException(status_code=503, detail="Agent not ready")

    message = req.message
    if req.filters:
        message += (
            "\n\n[UI filter panel] Apply exactly these filters on the tool call: "
            + json.dumps(req.filters)
        )

    try:
        answer_text, tool_results = await run_chat(agent, message, req.history)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Agent turn failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return presenter.present(req.message, answer_text, tool_results)


async def _run_turn(
    message: str, history: list[dict[str, str]], filters: dict[str, Any] | None
) -> tuple[str, list[ToolResult], DisplayPayload]:
    """Shared turn runner used by the AG-UI endpoint."""
    agent = _state["agent"]
    presenter: HybridPresenter = _state["presenter"]
    if filters:
        message += (
            "\n\n[UI filter panel] Apply exactly these filters on the tool call: "
            + json.dumps(filters)
        )
    answer_text, tool_results = await run_chat(agent, message, history)
    payload = presenter.present(message, answer_text, tool_results)
    return answer_text, tool_results, payload


@app.post("/agui")
async def agui(input_data: RunAgentInput, request: Request) -> StreamingResponse:
    """AG-UI protocol endpoint (SSE). Point @ag-ui/client's HttpAgent here."""
    if _state.get("agent") is None:
        raise HTTPException(status_code=503, detail="Agent not ready")
    from ag_ui.encoder import EventEncoder

    accept = request.headers.get("accept")
    return StreamingResponse(
        agui_event_stream(input_data, _run_turn, accept=accept),
        media_type=EventEncoder(accept=accept).get_content_type(),
    )


@app.get("/schema")
async def schema() -> dict[str, Any]:
    return rows_json_schema()


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
