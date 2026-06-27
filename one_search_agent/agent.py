"""One Search Vulnerability Assistant - LangGraph agent.

Connects to the (reused, unmodified) vulnerability_mcp MCP server over
stdio for all vulnerability retrieval - get_vulnerability_summary,
get_vulnerability_records, get_risk_ranking, get_remediation_trend,
resolve_application, resolve_user, list_applications, list_users.

Earlier versions of this agent had the LLM itself generate the
dashboard's UI as structured JSON via an A2UI tool (`generate_a2ui`).
That was dropped: it required an extra paid model call per turn, the
generated JSON failed validation a meaningful fraction of the time even
on a strong model, and failures occasionally leaked raw JSON fragments
into the visible chat text (a structural AG-UI limitation - a nested
model call's token stream can't be distinguished from the main agent's
reply at the wire-protocol level).

The dashboard is now built DETERMINISTICALLY in Python from the actual
tool call results each turn (see `_build_dashboard`) and attached to
the LangGraph state's `dashboard` key. AG-UI's standard state-sync
(STATE_SNAPSHOT) automatically streams any state field to the frontend
with zero extra protocol wiring - no LLM call, no validation, no
leak risk, and it's wrong only if the underlying tool data is wrong.
"""
from __future__ import annotations

import json
import os
from typing import Annotated, Any

from typing_extensions import TypedDict

from dotenv import load_dotenv
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import create_react_agent

load_dotenv()

PROJECT_DIR = os.environ.get(
    "VULN_MCP_PROJECT_DIR", "/Users/nilesh/Documents/projects/claud-playground"
)
PYTHON_BIN = os.environ.get("PYTHON_BIN", "python3")

mcp_client = MultiServerMCPClient(
    {
        "vulnerability": {
            "transport": "stdio",
            "command": PYTHON_BIN,
            "args": ["-m", "vulnerability_mcp.server"],
            "cwd": PROJECT_DIR,
        }
    }
)

# Static field/column definitions the frontend's FilterPanel/Table
# render from - these never change, so there's no need for the LLM (or
# anything else) to generate them per turn.
FILTER_FIELDS: list[dict[str, Any]] = [
    {"name": "severity", "label": "Severity", "component": "multiSelect",
     "options": ["Critical", "High", "Medium", "Low"]},
    {"name": "application", "label": "Application", "component": "text"},
    {"name": "businessUnit", "label": "Business Unit", "component": "text"},
    {"name": "owner", "label": "Owner", "component": "text"},
    {"name": "operatingSystem", "label": "Operating System", "component": "multiSelect",
     "options": ["RHEL 8", "Ubuntu 22.04", "Windows Server 2019", "Windows Server 2022",
                 "AIX 7.2", "Solaris 11"]},
    {"name": "environment", "label": "Environment", "component": "multiSelect",
     "options": ["Production", "Staging", "Development"]},
    {"name": "region", "label": "Region", "component": "text"},
    {"name": "isPastDue", "label": "Past Due", "component": "checkbox"},
    {"name": "isEscalated", "label": "Escalated", "component": "checkbox"},
    {"name": "internetFacing", "label": "Internet Facing", "component": "checkbox"},
    {"name": "kernelRelated", "label": "Kernel Related", "component": "checkbox"},
    {"name": "specificServer", "label": "Specific Server", "component": "text"},
]

TABLE_COLUMNS: list[dict[str, str]] = [
    {"key": "hostname", "label": "Hostname"},
    {"key": "application", "label": "Application"},
    {"key": "severity", "label": "Severity"},
    {"key": "cve", "label": "CVE"},
    {"key": "pastDue", "label": "Past Due"},
    {"key": "escalated", "label": "Escalated"},
    {"key": "os", "label": "OS"},
    {"key": "owner", "label": "Owner"},
    {"key": "dueDate", "label": "Due Date"},
    {"key": "internetFacing", "label": "Internet Facing"},
]

# Maps get_vulnerability_records' field names to TABLE_COLUMNS' keys.
_RECORD_FIELD_MAP = {
    "hostname": "hostname",
    "application_name": "application",
    "severity": "severity",
    "cve_id": "cve",
    "past_due_flag": "pastDue",
    "escalated_flag": "escalated",
    "operating_system": "os",
    "application_owner": "owner",
    "due_date": "dueDate",
    "internet_facing": "internetFacing",
}

# Tool result -> request-arg name mapping, used to surface "currently
# applied filters" into the FilterPanel's values without the LLM having
# to restate them anywhere.
_ARG_TO_FILTER_FIELD = {
    "severity": "severity",
    "application_names": "application",
    "application_ids": "application",
    "business_unit": "businessUnit",
    "application_owner": "owner",
    "operating_system": "operatingSystem",
    "environment": "environment",
    "regions": "region",
    "is_past_due": "isPastDue",
    "is_escalated": "isEscalated",
    "is_internet_facing": "internetFacing",
    "kernel_related": "kernelRelated",
    "specific_server": "specificServer",
}


def build_llm() -> ChatOpenAI:
    return ChatOpenAI(
        model=os.environ["OPENROUTER_MODEL"],
        api_key=os.environ["OPENROUTER_API_KEY"],
        base_url=os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
    )


SYSTEM_PROMPT = (
    "You are the One Search Vulnerability Assistant, a security analytics "
    "copilot for cybersecurity analysts and executives. You have access to "
    "these MCP tools:\n"
    "- get_vulnerability_summary: totals, dimensional breakdowns (severity, "
    "OS, platform, status, application, business unit, owner, kernel, "
    "internet-facing), and a CSV export for a set of filters.\n"
    "- get_vulnerability_records: a page of raw matching rows (hostname, "
    "application, severity, CVE, past-due/escalated, OS, owner, due date, "
    "internet-facing) - use this so the results table has real rows, NOT "
    "get_vulnerability_summary (which has no row-level data).\n"
    "- get_risk_ranking: composite risk score ranking of applications/"
    "business units/owners.\n"
    "- get_remediation_trend: month-by-month discovered/remediated/"
    "past-due/escalated counts, for trend-over-time questions.\n"
    "- resolve_application / resolve_user: fuzzy-match a free-text "
    "application or person reference to a canonical id, when the user "
    "names something that isn't already an exact known identifier "
    "('APP000' or a full email). If ambiguous, ask the user to "
    "disambiguate rather than guessing.\n"
    "- list_applications / list_users: full reference lists.\n\n"
    "ALWAYS call the appropriate tool(s) rather than guessing at numbers, "
    "and always pass every filter value the user (or a filter refinement) "
    "gave you into the matching tool argument on every call - an "
    "empty-args call queries the WHOLE dataset and silently produces "
    "wrong numbers for what should have been a filtered question. "
    "Whenever you call get_vulnerability_summary, also call "
    "get_vulnerability_records with the SAME filters in the same turn - "
    "the results table and the rest of the on-screen dashboard are built "
    "automatically from these two calls' actual results, not from "
    "anything you write, so they need real data to draw from.\n\n"
    "## Response structure\n"
    "For EVERY new search or filter refinement, respond with, in order:\n\n"
    "1. **Executive Summary** - one short paragraph stating the total "
    "matching count and the application/criteria it's scoped to, then a "
    "bullet list of: Critical count, High count, Past Due count, "
    "Escalated count, Internet-facing count. Use ONLY numbers that came "
    "back from a tool call in this turn - never invent or estimate one.\n\n"
    "2. **Insights** - 2-4 short bullet points of genuinely useful "
    "observations (e.g. 'X% of critical vulnerabilities are on Linux', "
    "'past-due findings are concentrated in N applications'). CRITICAL: "
    "only state a percentage or cross-tabulation you can actually back "
    "with data from a tool call. get_vulnerability_summary's breakdowns "
    "are independent per-dimension (severity counts and OS counts are "
    "separate, not jointly cross-tabulated) - if an insight needs a joint "
    "condition (e.g. 'critical AND on Linux'), make an ADDITIONAL "
    "get_vulnerability_summary call with both filters applied to get the "
    "real joint count before stating it. Never fabricate a percentage.\n\n"
    "An interactive dashboard (KPI cards, charts, a live filter panel, a "
    "results table, and a download button) is rendered automatically on "
    "screen below your text from the SAME tool calls described above - "
    "you do not generate it, request it, or describe it, and you must "
    "NOT write your own text about available filters or a download link "
    "(the FilterPanel and DownloadCard widgets already cover both, and "
    "restating them in text is just duplicate information). Just make "
    "the tool calls with the right filters and write the Executive "
    "Summary and Insights. Do not mention 'rendering a dashboard' or "
    "similar - it simply appears.\n\n"
    "## Filter refinement flow\n"
    "When you receive a message that looks like a structured filter-apply "
    "payload (starting with '[UI_ACTION apply_filters]' followed by JSON), "
    "treat it as a filter-update request, NOT a new conversation:\n"
    "- Merge the new payload's fields with whatever filters were applied "
    "in your most recent tool calls in this conversation (the new payload's "
    "values win per-field; fields it doesn't mention stay as they were; an "
    "explicit empty/false value in the payload clears that filter).\n"
    "- Re-call get_vulnerability_summary AND get_vulnerability_records "
    "with the MERGED filter set (plus any chart-backing tools relevant to "
    "what's being shown).\n"
    "- Produce the full Executive Summary / Insights text again, "
    "reflecting the updated results.\n\n"
    "Keep responses focused - the dashboard carries the detailed data, so "
    "your text should summarize and highlight, not restate every number."
)


def _iter_tool_calls(messages: list[BaseMessage]):
    """Yield (tool_name, args, full_result_text) for every tool call made
    across `messages`, in order."""
    results_by_id = {
        m.tool_call_id: _as_text(m.content) for m in messages if isinstance(m, ToolMessage)
    }
    for m in messages:
        if not isinstance(m, AIMessage):
            continue
        for call in m.tool_calls:
            yield call["name"], call["args"], results_by_id.get(call["id"], "")


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


def _latest(messages: list[BaseMessage], tool_name: str) -> tuple[dict | None, dict | None]:
    """The (args, parsed_result) of the LAST call to `tool_name` in
    `messages`, or (None, None) if it was never called / didn't parse."""
    args: dict | None = None
    payload: dict | None = None
    for name, call_args, result_text in _iter_tool_calls(messages):
        if name != tool_name:
            continue
        try:
            parsed = json.loads(result_text)
        except (json.JSONDecodeError, TypeError):
            continue
        args, payload = call_args, parsed
    return args, payload


def _build_dashboard(turn_messages: list[BaseMessage]) -> dict | None:
    """Deterministically build the dashboard payload from this turn's
    actual tool results - no LLM involved, so it's exactly as reliable
    as the underlying data."""
    summary_args, summary = _latest(turn_messages, "get_vulnerability_summary")
    if summary is None:
        return None

    s = summary.get("summary") or {}
    breakdowns = summary.get("breakdowns") or {}
    export = summary.get("export") or {}
    severity = breakdowns.get("severity_breakdown") or {}

    kpis = [
        {"title": "Total", "value": s.get("total_vulnerabilities", 0)},
        {"title": "Critical", "value": severity.get("Critical", 0)},
        {"title": "High", "value": severity.get("High", 0)},
        {"title": "Past Due", "value": s.get("total_past_due", 0)},
        {"title": "Escalated", "value": s.get("total_escalated", 0)},
        {"title": "Internet Facing", "value": s.get("total_internet_facing", 0)},
    ]

    total = s.get("total_vulnerabilities", 0)
    internet_facing = breakdowns.get("internet_facing_breakdown") or {}
    finding_category = breakdowns.get("finding_category_breakdown") or {}
    past_due_count = s.get("total_past_due", 0)
    exploitable_count = s.get("total_exploitable", 0)

    charts: list[dict[str, Any]] = []
    if severity:
        charts.append({
            "chartType": "donut", "title": "Findings by Severity",
            "xKey": "label", "series": ["value"],
            "data": [{"label": k, "value": v} for k, v in severity.items()],
        })
        charts.append({
            "chartType": "bar", "title": "Inherent Risk Count",
            "xKey": "label", "series": ["value"],
            "data": [{"label": k, "value": v} for k, v in severity.items()],
        })
    if internet_facing:
        charts.append({
            "chartType": "donut", "title": "Internet Facing",
            "xKey": "label", "series": ["value"],
            "data": [
                {"label": "Yes" if k == "True" else "No", "value": v}
                for k, v in internet_facing.items()
            ],
        })
    if finding_category:
        charts.append({
            "chartType": "bar", "title": "Findings by Platform",
            "xKey": "label", "series": ["value"],
            "data": [{"label": k, "value": v} for k, v in finding_category.items()],
        })
    if total:
        charts.append({
            "chartType": "donut", "title": "Past Due",
            "xKey": "label", "series": ["value"],
            "data": [
                {"label": "Yes", "value": past_due_count},
                {"label": "No", "value": total - past_due_count},
            ],
        })
        charts.append({
            "chartType": "donut", "title": "Exploitable",
            "xKey": "label", "series": ["value"],
            "data": [
                {"label": "Yes", "value": exploitable_count},
                {"label": "No", "value": total - exploitable_count},
            ],
        })

    _, ranking_payload = _latest(turn_messages, "get_risk_ranking")
    if ranking_payload and ranking_payload.get("ranking"):
        charts.append({
            "chartType": "horizontalBar",
            "title": f"Top {ranking_payload.get('dimension', 'application')} by risk",
            "xKey": "name", "series": ["risk_score"],
            "data": ranking_payload["ranking"][:10],
        })

    _, trend_payload = _latest(turn_messages, "get_remediation_trend")
    if trend_payload and trend_payload.get("trend"):
        charts.append({
            "chartType": "line", "title": "Remediation trend",
            "xKey": "month", "series": ["discovered", "remediated", "past_due", "escalated"],
            "data": trend_payload["trend"],
        })

    filter_values: dict[str, Any] = {}
    for arg_name, field_name in _ARG_TO_FILTER_FIELD.items():
        value = (summary_args or {}).get(arg_name)
        if value not in (None, "", [], False):
            filter_values[field_name] = value

    _, records_payload = _latest(turn_messages, "get_vulnerability_records")
    rows: list[dict[str, Any]] = []
    for record in (records_payload or {}).get("records", []):
        rows.append({
            col: record.get(src)
            for src, col in _RECORD_FIELD_MAP.items()
        })

    return {
        "kpis": kpis,
        "charts": charts,
        "filters": {"fields": FILTER_FIELDS, "values": filter_values},
        "table": {"columns": TABLE_COLUMNS, "rows": rows},
        "download": {
            "title": "Download Vulnerability Report",
            "fileName": export.get("file_name", "vulnerabilities.csv"),
            "downloadUrl": export.get("download_url"),
            "recordCount": export.get("record_count", s.get("total_vulnerabilities", 0)),
        },
    }


class _AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    dashboard: dict[str, Any] | None


def _turn_messages(messages: list[BaseMessage]) -> list[BaseMessage]:
    """The slice of `messages` belonging to the current turn - everything
    after the most recent HumanMessage."""
    boundary = len(messages)
    for i in range(len(messages) - 1, -1, -1):
        if isinstance(messages[i], HumanMessage):
            boundary = i
            break
    return messages[boundary:]


def _build_graph(inner_agent) -> StateGraph:
    async def call_inner(state: _AgentState, config) -> dict:
        result = await inner_agent.ainvoke({"messages": state["messages"]}, config)
        new_messages = result["messages"][len(state["messages"]) :]
        return {"messages": new_messages}

    def build_dashboard_node(state: _AgentState) -> dict:
        dashboard = _build_dashboard(_turn_messages(state["messages"]))
        # Keep the previous turn's dashboard if this turn didn't search
        # for anything (e.g. a pure follow-up question) rather than
        # blanking it out.
        return {"dashboard": dashboard} if dashboard is not None else {}

    graph = StateGraph(_AgentState)
    graph.add_node("inner", call_inner)
    graph.add_node("build_dashboard", build_dashboard_node)
    graph.set_entry_point("inner")
    graph.add_edge("inner", "build_dashboard")
    graph.add_edge("build_dashboard", END)
    return graph


async def build_agent():
    """Create a fresh ReAct agent with the MCP tools loaded, wrapped with
    the deterministic dashboard-building node described above.

    Backed by an in-memory checkpointer keyed on thread_id, so multi-turn
    conversations (filter refinements, follow-up questions) retain prior
    tool results and applied filters instead of starting over each turn.
    """
    mcp_tools = await mcp_client.get_tools()
    llm = build_llm()
    inner_agent = create_react_agent(llm, mcp_tools, prompt=SYSTEM_PROMPT)
    graph = _build_graph(inner_agent)
    return graph.compile(checkpointer=MemorySaver())
