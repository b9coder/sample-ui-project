"""FastAPI wrapper around the LangGraph vulnerability agent.

Run with:
    uvicorn server:app --host 0.0.0.0 --port 8001
"""
from __future__ import annotations

import json
from contextlib import asynccontextmanager

from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from pydantic import BaseModel

from agent import build_agent

_agent = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _agent
    _agent = await build_agent()
    yield


app = FastAPI(title="Vulnerability Agent API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    thread_id: str = "default"


class ReasoningStep(BaseModel):
    tool: str
    args: dict[str, Any]
    result: str


# Tools whose output is a direct, unmodified extract from the database
# (e.g. the CSV export from get_vulnerability_summary matches the DB
# exactly for the given filters) - responses backed by these are marked
# "Trusted". Computed/aggregated tools (risk ranking, trend buckets) are
# not flagged, since they're derived rather than raw extracts.
TRUSTED_TOOLS = {"get_vulnerability_summary"}

# Per-thread cache of the last parsed result for each tool, so a
# follow-up turn that answers from already-fetched data (no new tool
# call) can still produce a chart for whichever breakdown the user is
# now asking about.
_last_tool_payload: dict[str, dict[str, dict]] = {}

# Maps a keyword found in the user's message to the matching breakdown
# key in get_vulnerability_summary's response, and a display title.
BREAKDOWN_KEYWORDS: list[tuple[str, str, str]] = [
    ("severity", "severity_breakdown", "Severity breakdown"),
    ("operating system", "os_breakdown", "OS breakdown"),
    (" os ", "os_breakdown", "OS breakdown"),
    ("platform", "platform_breakdown", "Platform breakdown"),
    ("business unit", "business_unit_breakdown", "Business unit breakdown"),
    ("owner", "owner_breakdown", "Owner breakdown"),
    ("status", "status_breakdown", "Status breakdown"),
    ("kernel", "kernel_breakdown", "Kernel-related breakdown"),
    ("internet", "internet_facing_breakdown", "Internet-facing breakdown"),
    ("application", "application_breakdown", "Application breakdown"),
]


class ChartSpec(BaseModel):
    type: str  # "line" or "bar"
    title: str
    x_key: str
    series: list[str]
    data: list[dict[str, Any]]


class ChatResponse(BaseModel):
    reply: str
    reasoning: list[ReasoningStep] = []
    trusted: bool = False
    chart: ChartSpec | None = None


def _as_text(content: Any) -> str:
    """Normalize a message's `.content` (str, or list of content blocks) to text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                parts.append(block.get("text", str(block)))
        return "\n".join(parts)
    return str(content)


def _iter_tool_calls(turn_messages: list):
    """Yield (tool_name, args, full_result_text) for every tool call made
    in this turn, in order. Shared by reasoning extraction (which
    truncates the result for display) and chart building (which needs
    the full untruncated JSON)."""
    results_by_id = {
        m.tool_call_id: _as_text(m.content)
        for m in turn_messages
        if isinstance(m, ToolMessage)
    }
    for m in turn_messages:
        if not isinstance(m, AIMessage):
            continue
        for call in m.tool_calls:
            yield call["name"], call["args"], results_by_id.get(call["id"], "")


def _extract_reasoning(turn_messages: list) -> list[ReasoningStep]:
    """Pull tool-call/tool-result pairs out of this turn's messages."""
    return [
        ReasoningStep(
            tool=name,
            args=args,
            result=content if len(content) <= 2000 else content[:2000] + "…",
        )
        for name, args, content in _iter_tool_calls(turn_messages)
    ]


def _chart_from_payload(
    tool_name: str, payload: dict, breakdown_key: str | None = None, title: str | None = None
) -> ChartSpec | None:
    """Turn an already-parsed tool result into chart-ready data, if it
    has a natural chart representation."""
    if tool_name == "get_remediation_trend":
        trend = payload.get("trend") or []
        if not trend:
            return None
        return ChartSpec(
            type="line",
            title="Remediation trend",
            x_key="month",
            series=["discovered", "remediated", "past_due", "escalated"],
            data=trend,
        )

    if tool_name == "get_risk_ranking":
        ranking = payload.get("ranking") or []
        if not ranking:
            return None
        return ChartSpec(
            type="bar",
            title=f"Risk ranking by {payload.get('dimension', 'application')}",
            x_key="name",
            series=["risk_score"],
            data=ranking,
        )

    if tool_name == "get_vulnerability_summary":
        key = breakdown_key or "severity_breakdown"
        breakdown = (payload.get("breakdowns") or {}).get(key)
        if not breakdown:
            return None
        # Breakdowns are parts of one whole, so a donut chart reads
        # better than a bar - but only while the slice count stays
        # legible. Once there are too many groups (e.g. the top-20
        # application/owner breakdowns), fall back to a bar chart.
        chart_type = "donut" if len(breakdown) <= 8 else "bar"
        return ChartSpec(
            type=chart_type,
            title=title or key.replace("_", " ").title(),
            x_key="name",
            series=["value"],
            data=[{"name": k, "value": v} for k, v in breakdown.items()],
        )

    return None


def _build_chart(tool_name: str, result_text: str) -> ChartSpec | None:
    """Parse a tool's raw JSON result and build a chart from it."""
    try:
        payload = json.loads(result_text)
    except (json.JSONDecodeError, TypeError):
        return None
    return _chart_from_payload(tool_name, payload)


def _extract_chart(turn_messages: list) -> ChartSpec | None:
    """Return a chart for the most recent chart-eligible tool call in
    this turn (later calls take precedence if more than one was made)."""
    chart: ChartSpec | None = None
    for name, _args, content in _iter_tool_calls(turn_messages):
        built = _build_chart(name, content)
        if built is not None:
            chart = built
    return chart


def _chart_from_cache(cache: dict[str, dict], user_message: str) -> ChartSpec | None:
    """Fallback for follow-up turns that answer from already-fetched data
    (no new tool call this turn): infer which breakdown the user is now
    asking about from their message, and chart it from the cached
    get_vulnerability_summary result."""
    summary_payload = cache.get("get_vulnerability_summary")
    if not summary_payload:
        return None
    lowered = f" {user_message.lower()} "
    for keyword, breakdown_key, title in BREAKDOWN_KEYWORDS:
        if keyword in lowered:
            chart = _chart_from_payload(
                "get_vulnerability_summary", summary_payload, breakdown_key, title
            )
            if chart is not None:
                return chart
    return None


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    result = await _agent.ainvoke(
        {"messages": [HumanMessage(content=request.message)]},
        config={"configurable": {"thread_id": request.thread_id}},
    )
    messages = result["messages"]
    last_human_index = max(
        i for i, m in enumerate(messages) if isinstance(m, HumanMessage)
    )
    turn_messages = messages[last_human_index + 1 :]
    reply = _as_text(turn_messages[-1].content)
    reasoning = _extract_reasoning(turn_messages)
    trusted = any(step.tool in TRUSTED_TOOLS for step in reasoning)

    cache = _last_tool_payload.setdefault(request.thread_id, {})
    for name, _args, content in _iter_tool_calls(turn_messages):
        try:
            cache[name] = json.loads(content)
        except (json.JSONDecodeError, TypeError):
            continue

    chart = _extract_chart(turn_messages) or _chart_from_cache(cache, request.message)
    return ChatResponse(reply=reply, reasoning=reasoning, trusted=trusted, chart=chart)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
