"""A2UI Vulnerability Assistant - LangGraph agent.

A clean-room, A2UI-first counterpart to one_search_agent. It reuses the
same (unmodified) vulnerability_mcp MCP server for all data, but instead
of a deterministic dashboard it has the LLM GENERATE the on-screen UI as
an a2ui.org (https://a2ui.org) component tree - the canonical "agent
generates the interface" A2UI use case - which the frontend renders
through the real `@a2ui/react` library.

Two model calls per turn, by design:
  1. A ReAct agent calls the MCP tools and writes a short text reply.
  2. A second, structured-output call turns THIS turn's tool results
     into an A2UI component tree (constrained to a2ui_schema's Pydantic
     union, so it can only emit valid components).

The A2UI message list is attached to the LangGraph state's
`a2ui_messages` key; AG-UI's STATE_SNAPSHOT streams it to the frontend
with no extra protocol wiring.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Annotated, Any

import httpx
from typing_extensions import TypedDict

from dotenv import load_dotenv
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langchain_core.tools import BaseTool, StructuredTool
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import create_react_agent

from a2ui_schema import wrap_messages
from layout import (
    ARG_TO_FILTER_FIELD,
    Layout,
    bindable_paths,
    check_manifest_consistency,
    compile_layout,
)
from identity import get_current_employee_id
from suggestions import build_suggestions

logger = logging.getLogger(__name__)

load_dotenv()

PROJECT_DIR = os.environ.get(
    "VULN_MCP_PROJECT_DIR", "/Users/nilesh/Documents/projects/claud-playground"
)
PYTHON_BIN = os.environ.get("PYTHON_BIN", "python3")
A2UI_MODEL = os.environ.get("A2UI_MODEL") or os.environ.get("OPENROUTER_MODEL")

# Two ways to reach the vulnerability MCP server:
#   - VULN_MCP_URL set  -> connect to an INDEPENDENTLY-running HTTP MCP
#     service (started separately, e.g. `python -m vulnerability_mcp.server`
#     with VULN_MCP_MCP_TRANSPORT=streamable-http). This agent does NOT
#     spawn or manage it.
#   - VULN_MCP_URL unset -> spawn the server as a stdio subprocess (the
#     original behavior, convenient for local single-command dev).
VULN_MCP_URL = os.environ.get("VULN_MCP_URL")
if VULN_MCP_URL:
    _mcp_connection: dict[str, Any] = {"transport": "streamable_http", "url": VULN_MCP_URL}
else:
    _mcp_connection = {
        "transport": "stdio",
        "command": PYTHON_BIN,
        "args": ["-m", "vulnerability_mcp.server"],
        "cwd": PROJECT_DIR,
    }
mcp_client = MultiServerMCPClient({"vulnerability": _mcp_connection})

# Vulnerability-query tools that must carry the authenticated identity
# for access control (the MCP server ANDs an access clause whenever
# employee_id is set). Entity-lookup tools aren't gated.
_IDENTITY_INJECTED_TOOLS = {
    "get_vulnerability_summary",
    "get_vulnerability_records",
    "get_risk_ranking",
    "get_remediation_trend",
    "get_user_access",
    "get_scope_insights",
}

_DATA_TOOLS = (
    "get_user_access",
    "get_scope_insights",
    "get_vulnerability_summary",
    "get_vulnerability_records",
    "get_risk_ranking",
    "get_remediation_trend",
)


def _openrouter_ssl_kwargs() -> dict[str, Any]:
    """Honor OPENROUTER_SSL_VERIFY for corporate networks that terminate
    TLS with a self-signed / internal-CA proxy in front of OpenRouter:
      - unset / "true"  -> normal certificate verification (default)
      - "false"/"0"/"no" -> DISABLE verification (insecure; use only when
        you control/trust the network path to the proxy)
      - any other value  -> treated as a filesystem path to a CA bundle
        (the SECURE option - point it at your corporate root CA .pem)

    When verification is on we pass nothing and let the OpenAI SDK manage
    its own HTTP client; only a custom verify setting builds explicit
    httpx clients (sync + async, since tool calls run async)."""
    setting = os.environ.get("OPENROUTER_SSL_VERIFY", "true").strip()
    if setting.lower() in ("", "true", "1", "yes", "on"):
        return {}
    verify: bool | str = False if setting.lower() in ("false", "0", "no", "off") else setting
    return {
        "http_client": httpx.Client(verify=verify),
        "http_async_client": httpx.AsyncClient(verify=verify),
    }


def build_llm() -> ChatOpenAI:
    return ChatOpenAI(
        model=os.environ["OPENROUTER_MODEL"],
        api_key=os.environ["OPENROUTER_API_KEY"],
        base_url=os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
        **_openrouter_ssl_kwargs(),
    )


def build_a2ui_llm() -> ChatOpenAI:
    return ChatOpenAI(
        model=A2UI_MODEL,
        api_key=os.environ["OPENROUTER_API_KEY"],
        base_url=os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
        **_openrouter_ssl_kwargs(),
    )


SYSTEM_PROMPT = (
    "You are the A2UI Vulnerability Assistant, a security-analytics copilot. "
    "You have MCP tools for vulnerability data:\n"
    "- get_user_access: the current user's own access (owned apps, owned "
    "infrastructure, delegated access, admin groups, total visible count, and "
    "'access_reasons' - a structured WHY list). Call it for the session-start "
    "welcome and 'what can I see' questions.\n"
    "- get_scope_insights: actionable, high-level metrics about the user's "
    "vulnerability landscape (apps with overdue Critical, internet-facing "
    "High/Critical assets, past-due count, unremediated count, average open "
    "finding age). For the session-start orientation.\n"
    "- get_vulnerability_summary: totals + dimensional breakdowns (severity, "
    "OS, platform, status, application, business unit, owner, internet-facing) "
    "+ a CSV export, for a set of filters.\n"
    "- get_vulnerability_records: a page of raw matching rows (only when the "
    "user asks to see/list individual findings).\n"
    "- get_risk_ranking: composite risk ranking of applications/owners.\n"
    "- get_remediation_trend: month-by-month discovered/remediated counts.\n"
    "- resolve_application / resolve_user / list_applications / list_users: "
    "resolve fuzzy names to canonical ids; stop and ask if a lookup is "
    "ambiguous rather than guessing.\n\n"
    "ALWAYS call the appropriate tool(s) rather than guessing numbers, and "
    "pass every filter the user gave into the matching tool argument.\n\n"
    "## Session start - the ORIENTATION / landing experience\n"
    "When the message is exactly '[UI_ACTION session_start]', the user just "
    "landed and hasn't asked anything yet. Your job is to GROUND them before "
    "the conversation. Call get_user_access, get_vulnerability_summary (no "
    "filters), AND get_scope_insights, then write a structured welcome (this "
    "is the ONE turn where a longer, multi-section text reply is expected). "
    "Cover, using markdown headings + short bullets:\n"
    "  **Access Summary** - what they can access (applications, total "
    "vulnerabilities, Critical, High) AND why, listing each entry from "
    "get_user_access.access_reasons verbatim as a checkmark bullet (e.g. "
    "'✓ Application Owner (12 applications)', '✓ Delegate for Jane "
    "Smith', '✓ Risk Champion - Consumer Banking'). This 'why' comes "
    "from the authorization service - never invent a reason.\n"
    "  **Within your scope** - 3-5 of the most ACTIONABLE insights from "
    "get_scope_insights, phrased as findings not raw stats (e.g. 'N "
    "applications have overdue Critical vulnerabilities', 'N internet-facing "
    "assets carry High/Critical findings', 'average open finding age is N "
    "days'). Skip any metric that's zero. Keep it concise - orientation, not "
    "analysis; don't dump tables.\n"
    "Close with one short line inviting them to pick a starting point below. "
    "The on-screen surface shows the headline KPI tiles and a filter panel, "
    "and clickable suggested starting points appear under your text - so do "
    "NOT restate every number or tell them to type; just orient and invite.\n\n"
    "When the message starts with '[UI_ACTION apply_filters]' followed by "
    "JSON, treat it as a filter refinement from the on-screen filter panel: "
    "re-call get_vulnerability_summary with those filter values mapped to "
    "the matching tool arguments (severity, environment, operating_system, "
    "business_unit, regions, is_past_due, is_escalated, is_internet_facing) "
    "- and get_vulnerability_records too if the previous turn was showing a "
    "records table. Briefly note what changed.\n\n"
    "For every NORMAL turn (everything except session start), your TEXT reply "
    "is short - 2-4 sentences or bullets of genuine "
    "insight, nothing more. Do NOT restate every number, do NOT list records, "
    "and do NOT write a download link or 'click here to download' in your "
    "text - a rich interactive UI (KPI tiles, charts, a records table, a "
    "download button, a filter panel) is generated automatically from your "
    "tool results and shown below your text, and it already carries all the "
    "numbers, the table, and the download. Just make the right tool calls and "
    "write the brief insight, then stop."
)

A2UI_GEN_PROMPT = (
    "You design a VISUAL screen as an ordered list of ROWS. Each row holds "
    "one or more display elements; Python turns your rows into the final UI, "
    "so you only choose the rows, the elements, and their content - not any "
    "layout mechanics. IMPORTANT: this screen is VISUAL ONLY (numbers, "
    "charts, table, download, filter). The narration/insight text is already "
    "shown to the user as the chat reply above this screen - do NOT add any "
    "text/markdown/narration element here; it would just duplicate the "
    "reply.\n\n"
    "Answer the user's SPECIFIC question - the screen is the visual form of "
    "the assistant's written answer. Show only what's relevant: if they "
    "asked for a status breakdown, show the status chart, not every "
    "breakdown. Only show a broad multi-chart dashboard when the user asks "
    "for an overview / everything / session start (the tool payload contains "
    "many breakdowns as CONTEXT, not a mandate to chart all of them).\n\n"
    "TRUST (important): prefer binding data by REFERENCE so the trusted "
    "raw data is shown, not numbers you retyped. For a chart set 'dataRef' "
    "to one of the TRUSTED dataRef paths listed below; for a kpi set "
    "'valueRef' to one of the TRUSTED scalar paths. When you bind by "
    "reference, DO NOT also fill data/xKey/series (chart) or value (kpi) - "
    "Python fills them from the real data and marks the visual trusted. "
    "Only if NO listed path fits should you provide inline data/value "
    "yourself; that visual is then shown as AI-generated (untrusted). "
    "Never invent a path that isn't listed.\n\n"
    "Element types (visual only - NO text/markdown element exists):\n"
    "- kpi: a headline number tile - 'label' (what it is) + a 'valueRef' "
    "path (preferred) OR an inline 'value' string. One kpi per metric "
    "(Total, Past Due, Critical, ...); put several kpis in ONE row.\n"
    "- chart: 'chartType' donut/pie for yes-no or small categorical splits, "
    "bar for category counts, horizontalBar for a ranked list, line for a "
    "month-by-month trend. 'title' + a 'dataRef' path (preferred). Only if "
    "no path fits, provide inline 'xKey'/'series'/'data'. For a list-shaped "
    "dataRef you may still set 'xKey'/'series' to name which fields to plot. "
    "Put up to 2 related charts in one row; give a wide horizontalBar/line "
    "its own row.\n"
    "- table: a records table. Include ONLY if the user wanted to see "
    "individual findings AND get_vulnerability_records was called - Python "
    "fills in the rows, you just add an empty table element (optional "
    "'title').\n"
    "- download: a CSV download button - Python fills the URL from the "
    "summary export; add an empty download element (optional 'label').\n"
    "- filter: the refine-results panel - Python fills the fields; add an "
    "empty filter element. Include it when showing a summary/dashboard the "
    "user may want to narrow.\n\n"
    "PLACEMENT RULES (enforced by Python, but design for them): markdown, "
    "kpi, and chart elements may share a row. A table, a download, and a "
    "filter each get their OWN row and must NOT be combined with anything "
    "else - put each in a row by itself, typically near the end (charts/kpis "
    "first, then table, then download, then filter).\n\n"
    "Convert breakdown maps like {\"Critical\": 3, \"High\": 7} into chart "
    "data [{\"label\":\"Critical\",\"value\":3},{\"label\":\"High\","
    "\"value\":7}] with xKey 'label' and series ['value']. Only use data "
    "present below.\n\n"
)


def _as_text(content: Any) -> str:
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


def _iter_tool_calls(messages: list[BaseMessage]):
    results_by_id = {
        m.tool_call_id: _as_text(m.content) for m in messages if isinstance(m, ToolMessage)
    }
    for m in messages:
        if not isinstance(m, AIMessage):
            continue
        for call in m.tool_calls:
            yield call["name"], call["args"], results_by_id.get(call["id"], "")


def _latest_result(messages: list[BaseMessage], tool_name: str) -> dict | None:
    payload: dict | None = None
    for name, _, result_text in _iter_tool_calls(messages):
        if name != tool_name:
            continue
        try:
            payload = json.loads(result_text)
        except (json.JSONDecodeError, TypeError):
            continue
    return payload


def _turn_messages(messages: list[BaseMessage]) -> list[BaseMessage]:
    boundary = len(messages)
    for i in range(len(messages) - 1, -1, -1):
        if isinstance(messages[i], HumanMessage):
            boundary = i
            break
    return messages[boundary:]


def _collect_tool_data(turn: list[BaseMessage]) -> dict[str, Any]:
    """This turn's tool results, keyed by tool name (verbatim)."""
    data: dict[str, Any] = {}
    for tool_name in _DATA_TOOLS:
        payload = _latest_result(turn, tool_name)
        if payload is not None:
            data[tool_name] = payload
    return data


def _user_query(turn: list[BaseMessage]) -> str:
    """The user request that opened this turn (the sentinel is mapped to
    a plain-English intent so the UI generator treats it as 'welcome
    me' rather than charting a literal action string)."""
    for m in turn:
        if isinstance(m, HumanMessage):
            text = _as_text(m.content).strip()
            if text == "[UI_ACTION session_start]":
                return (
                    "Session start: welcome me and give an overview of the "
                    "vulnerabilities I can access."
                )
            return text
    return ""


def _assistant_text(turn: list[BaseMessage]) -> str:
    """The assistant's final text reply this turn (its written answer)."""
    for m in reversed(turn):
        if isinstance(m, AIMessage):
            text = _as_text(m.content).strip()
            if text:
                return text
    return ""


def _applied_filters(turn: list[BaseMessage]) -> dict[str, Any]:
    """The filter values behind this turn's latest summary call, mapped to
    filter-panel field names - so an injected filter element shows the
    currently-applied selection. Read from the tool call ARGUMENTS, which
    trusted code controls, not from anything the model restated."""
    args: dict[str, Any] = {}
    for name, call_args, _ in _iter_tool_calls(turn):
        if name == "get_vulnerability_summary":
            args = call_args or {}
    values: dict[str, Any] = {}
    for arg_name, field_name in ARG_TO_FILTER_FIELD.items():
        value = args.get(arg_name)
        if value not in (None, "", [], False):
            values[field_name] = value
    return values


async def _generate_a2ui(
    tool_data: dict[str, Any],
    applied_filters: dict[str, Any],
    user_query: str,
    assistant_text: str,
    llm: ChatOpenAI,
) -> list[dict] | None:
    """Have the LLM produce a ROW LAYOUT answering the user's question,
    then deterministically compile it (enforcing placement rules and
    injecting trusted table/download/filter data) into the a2ui message
    list. Returns None if nothing renderable resulted / the call failed
    (the frontend keeps its previous surface)."""
    if not tool_data:
        return None
    chart_paths, scalar_paths = bindable_paths(tool_data)
    # Full tool data can contain user PII / vulnerability details - keep it
    # at DEBUG so it never lands in normal (info) logs.
    logger.debug(
        "A2UI generation context: query=%r chart_paths=%s scalar_paths=%s",
        user_query, list(chart_paths), scalar_paths,
    )
    context = (
        f"User question: {user_query}\n\n"
        f"Assistant's written answer (the screen reinforces THIS, nothing "
        f"broader): {assistant_text}\n\n"
        f"TRUSTED dataRef paths for chart 'dataRef' (path: shape):\n"
        f"{json.dumps(chart_paths, indent=2, default=str)}\n\n"
        f"TRUSTED scalar paths for kpi 'valueRef':\n"
        f"{json.dumps(scalar_paths, default=str)}\n\n"
        f"Full tool results (context; bind via the paths above, don't copy "
        f"numbers unless no path fits):\n"
        f"{json.dumps(tool_data, default=str)}"
    )
    try:
        structured = llm.with_structured_output(Layout, method="function_calling")
        layout = await structured.ainvoke(A2UI_GEN_PROMPT + context)
        logger.debug("A2UI layout produced: %d rows", len(layout.rows))
    except Exception:
        logger.exception("A2UI generation failed; keeping the previous surface")
        return None

    components = compile_layout(layout, tool_data, applied_filters)
    if not components:
        return None
    return wrap_messages(components)


class _AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    a2ui_messages: list[dict[str, Any]] | None
    # 2-3 related follow-up questions to show under the answer (see
    # suggestions.py); the frontend renders them as clickable chips.
    suggestions: list[str] | None


def _build_graph(inner_agent, a2ui_llm: ChatOpenAI) -> StateGraph:
    async def call_inner(state: _AgentState, config) -> dict:
        result = await inner_agent.ainvoke({"messages": state["messages"]}, config)
        new_messages = result["messages"][len(state["messages"]) :]
        return {"messages": new_messages}

    async def generate_ui(state: _AgentState) -> dict:
        turn = _turn_messages(state["messages"])
        tool_data = _collect_tool_data(turn)
        called_any = any(name in _DATA_TOOLS for name, _, _ in _iter_tool_calls(turn))
        user_query = _user_query(turn)
        assistant_text = _assistant_text(turn)

        a2ui_messages = await _generate_a2ui(
            tool_data, _applied_filters(turn), user_query, assistant_text, a2ui_llm
        )

        # Related follow-up questions - shown whenever this turn produced a
        # substantive (tool-backed) answer; skipped for pure follow-ups so
        # stale chips from the previous turn stay put.
        update: dict[str, Any] = {}
        if called_any:
            update["suggestions"] = await build_suggestions(
                tool_data, user_query, assistant_text, a2ui_llm
            )

        if a2ui_messages is not None:
            update["a2ui_messages"] = a2ui_messages
        elif called_any:
            # A data turn that produced nothing renderable - clear stale UI.
            update["a2ui_messages"] = None
        return update

    graph = StateGraph(_AgentState)
    graph.add_node("inner", call_inner)
    graph.add_node("generate_ui", generate_ui)
    graph.set_entry_point("inner")
    graph.add_edge("inner", "generate_ui")
    graph.add_edge("generate_ui", END)
    return graph


def _with_injected_identity(tool: BaseTool) -> BaseTool:
    """Force every access-gated tool call to carry the trusted
    employee_id, overwriting anything the LLM supplied."""
    if tool.name not in _IDENTITY_INJECTED_TOOLS:
        return tool

    async def _call(**kwargs: Any) -> Any:
        kwargs["employee_id"] = get_current_employee_id()
        return await tool.ainvoke(kwargs)

    return StructuredTool.from_function(
        coroutine=_call,
        name=tool.name,
        description=tool.description,
        args_schema=tool.args_schema,
    )


async def build_agent():
    mcp_tools = await mcp_client.get_tools()
    mcp_tools = [_with_injected_identity(t) for t in mcp_tools]
    # Surface any drift between the UI-owned catalog manifest and this
    # agent's capabilities at startup (logged, non-fatal).
    check_manifest_consistency()
    inner_agent = create_react_agent(build_llm(), mcp_tools, prompt=SYSTEM_PROMPT)
    graph = _build_graph(inner_agent, build_a2ui_llm())
    return graph.compile(checkpointer=MemorySaver())
