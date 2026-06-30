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

In addition to `dashboard`, every turn also gets a declarative UI
description in the `ui_spec`/`ui_data` state keys (see
`_build_ui_data`/`_build_ui_spec`) - a generic, renderer-agnostic
alternative to `dashboard` that strictly separates presentation from
trusted data:

- `ui_data` is a registry of this turn's MCP tool results, copied
  VERBATIM (see `_build_ui_data`) - never reshaped, aggregated, or
  rewritten, so it's exactly as trustworthy as the tool that produced
  it.
- `ui_spec` (see `_build_ui_spec`) is a layout (rows of components)
  plus a components list, where every `chart`/`table` component
  references its data via a `dataRef` STRING (a dotted path into
  `ui_data`, e.g. "get_vulnerability_summary.breakdowns.
  severity_breakdown") rather than embedding any values - the
  component only carries presentation metadata (chart type, which
  field names to plot, column labels). The frontend resolves each
  `dataRef` and binds the real tool data directly (see
  one_search_ui/src/declarative/). `markdown` components are the only
  place free-text/AI-influenced content belongs, since they don't
  carry a trust claim about matching the underlying numbers exactly.

This is built 100% deterministically, same as `dashboard` - no LLM is
involved in either the data extraction or the layout decision, by
design: an LLM choosing which dataRef paths exist is just as failure-
prone as an LLM emitting raw chart data, so there is no robustness
benefit to making the LAYOUT dynamic via an LLM call here, only risk.
Both `dashboard` and `ui_spec`/`ui_data` are populated every turn from
the same tool results - `dashboard` is untouched for full backward
compatibility, and `ui_spec`/`ui_data` is the new, more general
representation the frontend can adopt incrementally.
"""
from __future__ import annotations

import json
import os
from typing import Annotated, Any

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

from identity import get_current_employee_id

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
    {"name": "application", "label": "Application", "component": "searchableMultiSelect",
     "entitySource": "applications"},
    {"name": "businessUnit", "label": "Business Unit", "component": "text"},
    {"name": "owner", "label": "Owner", "component": "searchableMultiSelect",
     "entitySource": "users"},
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

_FIELD_OPTIONS = {f["name"]: f["options"] for f in FILTER_FIELDS if f.get("options")}

_SEVERITY_ORDER = ["Critical", "High", "Medium", "Low"]


def _ordered_severity_items(severity: dict[str, int]) -> list[tuple[str, int]]:
    """severity_breakdown's key order depends on the database's GROUP BY
    and isn't guaranteed - always show Critical/High/Medium/Low in that
    fixed order on charts, regardless of how the DB returned them."""
    ordered = [(label, severity[label]) for label in _SEVERITY_ORDER if label in severity]
    # Any unexpected severity value (shouldn't happen given
    # ALLOWED_SEVERITIES, but don't silently drop data if it does).
    ordered += [(k, v) for k, v in severity.items() if k not in _SEVERITY_ORDER]
    return ordered


def _normalize_filter_display_value(field_name: str, value: Any) -> Any:
    """Map a raw filter value (whatever casing/abbreviation the LLM
    used, e.g. "prod") to the canonical option string ("Production") so
    the FilterPanel's chips show as selected - the query itself already
    matches case-insensitively/by-prefix server-side (see
    vulnerability_repository.py's add_in_ci/add_in_prefix), but the
    *displayed* value needs to be the exact option string to highlight
    correctly."""
    options = _FIELD_OPTIONS.get(field_name)
    if not options:
        return value

    def normalize_one(raw: str) -> str:
        for opt in options:
            if opt.lower() == raw.lower() or opt.lower().startswith(raw.lower()):
                return opt
        return raw

    if isinstance(value, list):
        return [normalize_one(v) if isinstance(v, str) else v for v in value]
    if isinstance(value, str):
        return normalize_one(value)
    return value


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

# Tool calls that constitute "this turn searched for something" - used
# to decide whether a missing dashboard means "nothing to show, clear
# it" vs. "this was a pure follow-up, leave the previous one alone".
_SEARCH_TOOLS = {"get_vulnerability_summary", "get_risk_ranking", "get_remediation_trend"}


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
    "internet-facing). ONLY call this when the user is specifically "
    "asking to see/list individual vulnerabilities or records (e.g. "
    "'show me the vulnerabilities for app X', 'list critical findings') "
    "- NOT for a general summary/analytics/KPI question, where it would "
    "add an unwanted raw-rows table the user didn't ask for. When you do "
    "call it, get_vulnerability_summary (which has no row-level data) is "
    "still the one that drives the KPI/chart numbers.\n"
    "- get_risk_ranking: composite risk score ranking of applications/"
    "business units/owners.\n"
    "- get_remediation_trend: month-by-month discovered/remediated/"
    "past-due/escalated counts, for trend-over-time questions.\n"
    "- resolve_application / resolve_user: fuzzy-match a free-text "
    "application or person reference to a canonical id, when the user "
    "names something that isn't already an exact known identifier "
    "('APP000' or a full email). When resolve_user comes back "
    "status='ambiguous', check len(candidates) FIRST, before writing "
    "anything:\n"
    "  * 10 or fewer candidates: list each one's name, ECN, email, "
    "department, AND role (never omit the email - it's the detail "
    "users actually recognize their colleagues by).\n"
    "  * MORE than 10 candidates: the name is too common to usefully "
    "list at all. Do NOT name or list a single one of them, and do NOT "
    "show any count, ECN, or other detail from the list. Your ENTIRE "
    "reply must be one short question asking the user for the person's "
    "email address (or another identifying detail like ECN or "
    "department), then call resolve_user again with whatever they give "
    "you.\n"
    "  CRITICAL: if the user's goal is to search/filter VULNERABILITIES "
    "by that person (not just 'who is X'), STOP at the ambiguous result "
    "and ask which one they mean - do NOT call get_vulnerability_summary "
    "or get_vulnerability_records yet. Never query multiple candidate "
    "ECNs SEPARATELY (one tool call per ECN) and present the results "
    "together as if 'John Smith' were one person - they're different "
    "people, and blending or sequentially dumping their data is exactly "
    "the wrong-attribution mistake disambiguation exists to prevent.\n"
    "  Once the user confirms which person/people they mean - whether "
    "that's one ('the one in Finance', a specific email/ECN) or "
    "several ('both of them', 'all three', multiple emails at once) - "
    "make exactly ONE get_vulnerability_summary call (plus "
    "get_vulnerability_records too, if a listing was requested) with "
    "application_owner set to the full list of all confirmed ECNs "
    "together, e.g. application_owner=[\"E100022\",\"E100023\"]. This "
    "produces one consolidated dashboard covering everyone confirmed, "
    "not one call (and one dashboard) per person.\n"
    "- list_applications / list_users: full reference lists.\n\n"
    "## Ownership lookups (not a vulnerability search)\n"
    "Two question types are about ownership/org-chart facts, not "
    "vulnerability data - don't call get_vulnerability_summary/records "
    "for these, and they don't produce a dashboard:\n"
    "- 'What applications does <person> own?' - resolve the person to "
    "one ECN first (resolve_user, same ambiguity rules as above - stop "
    "and ask if ambiguous/not_found rather than guessing), then call "
    "list_applications(owner_ecn=<that ECN>) - pass the ECN as the "
    "filter argument, don't fetch every application and filter the "
    "list yourself. Present as a plain list (application_id, name, "
    "business unit, environment) - if there are none, say so plainly.\n"
    "- 'Who owns <application>?' - resolve the application to one "
    "application_id first (resolve_application, same rule - stop and "
    "ask if ambiguous/not_found), take its owner_ecn, then call "
    "resolve_user with that ECN as the query (an ECN matches exactly, "
    "so this always resolves outright) to get the owner's full name, "
    "email, department, role, and band. Present those details, not "
    "just the bare ECN.\n\n"
    "ALWAYS call the appropriate tool(s) rather than guessing at numbers, "
    "and always pass every filter value the user (or a filter refinement) "
    "gave you into the matching tool argument on every call - an "
    "empty-args call queries the WHOLE dataset and silently produces "
    "wrong numbers for what should have been a filtered question. The "
    "on-screen KPI/chart dashboard and (when relevant) records table are "
    "built automatically from these tool calls' actual results, not from "
    "anything you write, so they need real data to draw from.\n\n"
    "## Response structure\n"
    "For EVERY new search or filter refinement, your ENTIRE text reply is "
    "just one thing:\n\n"
    "**Insights** - 2-4 short bullet points of genuinely useful "
    "observations (e.g. 'X% of critical vulnerabilities are on Linux', "
    "'past-due findings are concentrated in N applications'). CRITICAL: "
    "only state a percentage or cross-tabulation you can actually back "
    "with data from a tool call. get_vulnerability_summary's breakdowns "
    "are independent per-dimension (severity counts and OS counts are "
    "separate, not jointly cross-tabulated) - if an insight needs a joint "
    "condition (e.g. 'critical AND on Linux'), make an ADDITIONAL "
    "get_vulnerability_summary call with both filters applied to get the "
    "real joint count before stating it. Never fabricate a percentage.\n\n"
    "Your text reply MUST end after the Insights bullets - no further "
    "heading, section, or sentence after them, ever. In particular, do "
    "NOT write an Executive Summary, do NOT restate the total/Critical/"
    "High/Past Due/Escalated/Internet-facing counts as a bullet list or "
    "paragraph, and do NOT list individual vulnerability records in ANY "
    "form - not a markdown table, not a numbered list, not a bulleted "
    "per-record breakdown (e.g. 'Vulnerability ID: ... Hostname: ... CVE: "
    "...' repeated per row), not a 'Detailed List of...' section. This "
    "applies no matter how few rows matched or how the user phrased the "
    "request ('show me', 'list them', 'give me details on each one') - "
    "the answer to a request for a list of vulnerabilities is STILL just "
    "Insights bullets in your text; the actual rows belong exclusively in "
    "the results table that renders automatically below your text, never "
    "spelled out by you. Likewise do NOT write a download link or "
    "mention the CSV/export/download_url in any form (e.g. 'you can "
    "download the results here [link]'). An interactive dashboard (KPI "
    "cards, charts, a live filter panel, a full results table, and a "
    "download button) is rendered automatically on screen below your text "
    "from the SAME tool calls described above, and it already covers all "
    "of that. You do not generate it, request it, or describe it - just "
    "make the tool calls with the right filters and write the Insights "
    "bullets, then stop. Do not mention 'rendering a dashboard' or "
    "similar - it simply appears.\n\n"
    "## Filter refinement flow\n"
    "When you receive a message that looks like a structured filter-apply "
    "payload (starting with '[UI_ACTION apply_filters]' followed by JSON), "
    "treat it as a filter-update request, NOT a new conversation:\n"
    "- Merge the new payload's fields with whatever filters were applied "
    "in your most recent tool calls in this conversation (the new payload's "
    "values win per-field; fields it doesn't mention stay as they were; an "
    "explicit empty/false value in the payload clears that filter).\n"
    "- Re-call get_vulnerability_summary with the MERGED filter set (plus "
    "get_vulnerability_records too, but only if the turn you're refining "
    "was itself a records listing - don't introduce one that wasn't "
    "there before; same for any chart-backing tools relevant to what's "
    "being shown). The payload's 'application' values are always "
    "canonical application_ids (selected from a dropdown, not typed "
    "free text) - map them to the application_ids argument, never "
    "application_names. Likewise 'owner' values are always ECNs - map "
    "them to application_owner directly, no resolve_user call needed.\n"
    "- Produce the Insights bullets again, reflecting the updated "
    "results.\n\n"
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


_RESOLUTION_TOOLS = {"resolve_user", "resolve_application"}


def _had_unresolved_entity(turn_messages: list[BaseMessage]) -> bool:
    """True if this turn called resolve_user/resolve_application and got
    back 'ambiguous' or 'not_found' for any of them.

    The model is instructed to stop and ask the user to disambiguate
    rather than searching anyway, but that's a soft prompt rule and
    isn't perfectly reliable - it can still slip and call
    get_vulnerability_summary/get_vulnerability_records for one
    candidate while ALSO asking the question in its text reply. This
    is the hard backend backstop: whenever an entity reference in this
    turn was left unresolved, no dashboard or records panel is shown at
    all, regardless of what else got called - showing data attributed
    to an unconfirmed identity is worse than showing nothing.
    """
    for name, _, result_text in _iter_tool_calls(turn_messages):
        if name not in _RESOLUTION_TOOLS:
            continue
        try:
            parsed = json.loads(result_text)
        except (json.JSONDecodeError, TypeError):
            continue
        if parsed.get("status") in ("ambiguous", "not_found"):
            return True
    return False


def _build_dashboard(turn_messages: list[BaseMessage]) -> dict | None:
    """Deterministically build the dashboard payload from this turn's
    actual tool results - no LLM involved, so it's exactly as reliable
    as the underlying data.

    Each section (KPIs/severity-derived charts/filters/table/download
    vs. the risk-ranking chart vs. the remediation-trend chart) depends
    on a DIFFERENT tool call, and a turn may only have made some of
    them (e.g. a pure trend question never calls
    get_vulnerability_summary) - so each is gated independently rather
    than the whole dashboard bailing out if any one is missing.
    """
    summary_args, summary = _latest(turn_messages, "get_vulnerability_summary")
    _, ranking_payload = _latest(turn_messages, "get_risk_ranking")
    _, trend_payload = _latest(turn_messages, "get_remediation_trend")

    has_ranking = bool(ranking_payload and ranking_payload.get("ranking"))
    has_trend = bool(trend_payload and trend_payload.get("trend"))
    if summary is None and not has_ranking and not has_trend:
        return None

    kpis: list[dict[str, Any]] = []
    charts: list[dict[str, Any]] = []
    filter_values: dict[str, Any] = {}
    download: dict[str, Any] | None = None

    # A summary call that matched zero rows has nothing worth putting on
    # screen - KPI tiles full of zeros, an empty table, and a 0-row
    # download button look broken, not informative. The model's own
    # Insights text already says "no vulnerabilities found"; let that
    # speak for itself instead of rendering an empty dashboard under it.
    summary_total = (summary.get("summary") or {}).get("total_vulnerabilities", 0) if summary else 0
    if summary is not None and summary_total > 0:
        s = summary.get("summary") or {}
        breakdowns = summary.get("breakdowns") or {}
        export = summary.get("export") or {}
        severity = breakdowns.get("severity_breakdown") or {}
        total = s.get("total_vulnerabilities", 0)
        internet_facing = breakdowns.get("internet_facing_breakdown") or {}
        finding_category = breakdowns.get("finding_category_breakdown") or {}
        past_due_count = s.get("total_past_due", 0)
        exploitable_count = s.get("total_exploitable", 0)

        kpis = [
            {"title": "Total", "value": total},
            {"title": "Critical", "value": severity.get("Critical", 0)},
            {"title": "High", "value": severity.get("High", 0)},
            {"title": "Past Due", "value": past_due_count},
            {"title": "Escalated", "value": s.get("total_escalated", 0)},
            {"title": "Internet Facing", "value": s.get("total_internet_facing", 0)},
        ]

        if severity:
            severity_data = [{"label": k, "value": v} for k, v in _ordered_severity_items(severity)]
            charts.append({
                "chartType": "donut", "title": "Findings by Severity",
                "xKey": "label", "series": ["value"],
                "data": severity_data,
            })
            charts.append({
                "chartType": "bar", "title": "Inherent Risk Count",
                "xKey": "label", "series": ["value"],
                "data": severity_data,
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

        for arg_name, field_name in _ARG_TO_FILTER_FIELD.items():
            value = (summary_args or {}).get(arg_name)
            if value not in (None, "", [], False):
                filter_values[field_name] = _normalize_filter_display_value(field_name, value)

        download = {
            "title": "Download Vulnerability Report",
            "fileName": export.get("file_name", "vulnerabilities.csv"),
            "downloadUrl": export.get("download_url"),
            "recordCount": export.get("record_count", total),
        }

    if has_ranking:
        charts.append({
            "chartType": "horizontalBar",
            "title": f"Top {ranking_payload.get('dimension', 'application')} by risk",
            "xKey": "name", "series": ["risk_score"],
            "data": ranking_payload["ranking"][:10],
        })

    if has_trend:
        charts.append({
            "chartType": "line", "title": "Remediation trend",
            "xKey": "month", "series": ["discovered", "remediated", "past_due", "escalated"],
            "data": trend_payload["trend"],
        })

    if not kpis and not charts and download is None:
        return None

    return {
        "kpis": kpis,
        "charts": charts,
        "filters": {"fields": FILTER_FIELDS, "values": filter_values},
        "download": download,
    }


def _build_records_table(turn_messages: list[BaseMessage]) -> dict | None:
    """A standalone table of raw rows, separate from the analytics
    dashboard above - covers a plain listing request ("show me
    vulnerabilities for app X") just as well as an analytics one, since
    get_vulnerability_records is called alongside get_vulnerability_summary
    on every search per the system prompt."""
    _, records_payload = _latest(turn_messages, "get_vulnerability_records")
    if records_payload is None:
        return None

    rows = [
        {col: record.get(src) for src, col in _RECORD_FIELD_MAP.items()}
        for record in records_payload.get("records", [])
    ]
    if not rows:
        return None

    return {"columns": TABLE_COLUMNS, "rows": rows}


# The MCP tools whose results get registered VERBATIM into ui_data,
# keyed by tool name - the full set of dataRef "namespaces" available
# to ui_spec's components.
_UI_DATA_TOOLS = (
    "get_vulnerability_summary",
    "get_vulnerability_records",
    "get_risk_ranking",
    "get_remediation_trend",
)


def _build_ui_data(turn_messages: list[BaseMessage]) -> dict[str, Any] | None:
    """The trusted dataset registry ui_spec's dataRef strings address
    into: this turn's MCP tool results, copied VERBATIM and keyed by
    tool name - never reshaped, aggregated, or rewritten, so its
    trustworthiness is identical to the tool call that produced it.

    Also includes two synthetic entries, each a plain field SELECTION
    from the verbatim tool payloads above (no math beyond what the
    tool already computed, no LLM involvement):
    - "_filters": the static filter FIELD DEFINITIONS plus this turn's
      actually-applied filter VALUES (derived the exact same way
      _build_dashboard's filter_values is), so an input_form component
      can hydrate its current selection without the agent restating
      anything - the values come straight from the summary tool
      call's own arguments.
    - "_kpis": get_vulnerability_summary's headline numbers picked out
      into a flat {title, value} list, for a "kpi" component to bind
      to - same 6 fields _build_dashboard's kpis list uses, just
      exposed here as a dataRef target instead of baked into a
      dashboard-shaped dict.
    """
    registry: dict[str, Any] = {}
    for tool_name in _UI_DATA_TOOLS:
        _, payload = _latest(turn_messages, tool_name)
        if payload is not None:
            registry[tool_name] = payload

    summary_args, _ = _latest(turn_messages, "get_vulnerability_summary")
    filter_values: dict[str, Any] = {}
    for arg_name, field_name in _ARG_TO_FILTER_FIELD.items():
        value = (summary_args or {}).get(arg_name)
        if value not in (None, "", [], False):
            filter_values[field_name] = _normalize_filter_display_value(field_name, value)
    registry["_filters"] = {"fields": FILTER_FIELDS, "values": filter_values}

    summary = registry.get("get_vulnerability_summary")
    summary_total = (summary.get("summary") or {}).get("total_vulnerabilities", 0) if summary else 0
    if summary is not None and summary_total > 0:
        s = summary.get("summary") or {}
        severity = (summary.get("breakdowns") or {}).get("severity_breakdown") or {}
        registry["_kpis"] = [
            {"title": "Total", "value": summary_total},
            {"title": "Critical", "value": severity.get("Critical", 0)},
            {"title": "High", "value": severity.get("High", 0)},
            {"title": "Past Due", "value": s.get("total_past_due", 0)},
            {"title": "Escalated", "value": s.get("total_escalated", 0)},
            {"title": "Internet Facing", "value": s.get("total_internet_facing", 0)},
        ]
        # get_vulnerability_summary returns past-due/exploitable only as
        # totals (total_past_due/total_exploitable), not as a ready-made
        # Yes/No breakdown object the way severity/internet-facing are -
        # these two entries are the one-step arithmetic derivation
        # (total minus the trusted count = the complementary count)
        # needed to chart them, same as _build_dashboard already does.
        registry["_past_due_breakdown"] = {
            "Yes": s.get("total_past_due", 0),
            "No": summary_total - s.get("total_past_due", 0),
        }
        registry["_exploitable_breakdown"] = {
            "Yes": s.get("total_exploitable", 0),
            "No": summary_total - s.get("total_exploitable", 0),
        }

    return registry or None


# Declarative-table column definitions for get_vulnerability_records -
# unlike TABLE_COLUMNS/_RECORD_FIELD_MAP above, "key" here is the RAW
# field name verbatim from the tool's record objects (e.g.
# "application_name", not "application") - the table component binds
# straight to ui_data without any field renaming, per the "pass trusted
# data to the UI without modification" rule. Only "label" (the
# column header text) is presentation metadata.
_RECORD_TABLE_COLUMNS: list[dict[str, str]] = [
    {"key": "hostname", "label": "Hostname"},
    {"key": "application_name", "label": "Application"},
    {"key": "severity", "label": "Severity"},
    {"key": "cve_id", "label": "CVE"},
    {"key": "past_due_flag", "label": "Past Due"},
    {"key": "escalated_flag", "label": "Escalated"},
    {"key": "operating_system", "label": "OS"},
    {"key": "application_owner", "label": "Owner"},
    {"key": "due_date", "label": "Due Date"},
    {"key": "internet_facing", "label": "Internet Facing"},
]


def _build_ui_spec(ui_data: dict[str, Any] | None) -> dict[str, Any] | None:
    """Layout (rows of components) + a components list for the
    declarative rendering model. Every chart/table component carries a
    "dataRef" STRING - a dotted path into `ui_data` (e.g.
    "get_vulnerability_summary.breakdowns.severity_breakdown" or
    "get_vulnerability_records.records") - never any actual values;
    the frontend resolves each dataRef and binds the real (unmodified)
    tool data straight to the chart/table. "chart" config only
    declares presentation metadata (chart type, which field NAMES to
    plot) - never data. The one exception is "markdown" components,
    whose text is free-form by design (here it's still deterministic,
    built straight from trusted numbers - see the inline comment below
    - but the type permits AI-authored text too, since unlike chart/
    table it carries no claim of being a verbatim data binding).

    Built 100% from `ui_data`'s already-trusted registry - no LLM call,
    same reasoning as `_build_dashboard`.
    """
    if not ui_data:
        return None

    summary = ui_data.get("get_vulnerability_summary")
    records = ui_data.get("get_vulnerability_records")
    ranking = ui_data.get("get_risk_ranking")
    trend = ui_data.get("get_remediation_trend")

    summary_total = (summary.get("summary") or {}).get("total_vulnerabilities", 0) if summary else 0
    has_summary = summary is not None and summary_total > 0
    has_records = bool(records and records.get("records"))
    has_ranking = bool(ranking and ranking.get("ranking"))
    has_trend = bool(trend and trend.get("trend"))
    if not has_summary and not has_records and not has_ranking and not has_trend:
        return None

    components: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []

    if has_summary:
        breakdowns = summary.get("breakdowns") or {}
        severity = breakdowns.get("severity_breakdown") or {}

        components.append({
            "id": "kpi_summary", "type": "kpi",
            "dataRef": "_kpis",
        })
        rows.append({"columns": [{"componentId": "kpi_summary", "width": 4}]})

        # All 4 donuts share one row (matches legacy Dashboard.tsx,
        # which groups every donut/pie-typed chart together regardless
        # of source) - bar charts each get their own full-width row.
        donut_ids = []
        if severity:
            components.append({
                "id": "severity_chart", "type": "chart", "title": "Findings by Severity",
                "dataRef": "get_vulnerability_summary.breakdowns.severity_breakdown",
                "chart": {"chartType": "donut"},
            })
            donut_ids.append("severity_chart")
        if breakdowns.get("internet_facing_breakdown"):
            components.append({
                "id": "internet_facing_chart", "type": "chart", "title": "Internet Facing",
                "dataRef": "get_vulnerability_summary.breakdowns.internet_facing_breakdown",
                "chart": {"chartType": "donut"},
            })
            donut_ids.append("internet_facing_chart")
        if "_past_due_breakdown" in ui_data:
            components.append({
                "id": "past_due_chart", "type": "chart", "title": "Past Due",
                "dataRef": "_past_due_breakdown",
                "chart": {"chartType": "donut"},
            })
            donut_ids.append("past_due_chart")
        if "_exploitable_breakdown" in ui_data:
            components.append({
                "id": "exploitable_chart", "type": "chart", "title": "Exploitable",
                "dataRef": "_exploitable_breakdown",
                "chart": {"chartType": "donut"},
            })
            donut_ids.append("exploitable_chart")
        if donut_ids:
            rows.append({"columns": [{"componentId": cid, "width": 1} for cid in donut_ids]})

        # Same severity dataRef as the donut above, just charted as a
        # bar too - no new/different data, only a second presentation
        # of the identical trusted breakdown.
        if severity:
            components.append({
                "id": "severity_bar_chart", "type": "chart", "title": "Inherent Risk Count",
                "dataRef": "get_vulnerability_summary.breakdowns.severity_breakdown",
                "chart": {"chartType": "bar"},
            })
            rows.append({"columns": [{"componentId": "severity_bar_chart", "width": 4}]})

        if breakdowns.get("finding_category_breakdown"):
            components.append({
                "id": "platform_chart", "type": "chart", "title": "Findings by Platform",
                "dataRef": "get_vulnerability_summary.breakdowns.finding_category_breakdown",
                "chart": {"chartType": "bar"},
            })
            rows.append({"columns": [{"componentId": "platform_chart", "width": 4}]})

    if has_ranking:
        components.append({
            "id": "ranking_chart", "type": "chart",
            "title": f"Top {ranking.get('dimension', 'application')} by risk",
            "dataRef": "get_risk_ranking.ranking",
            "chart": {"chartType": "horizontalBar", "xKey": "name", "series": ["risk_score"]},
        })
        rows.append({"columns": [{"componentId": "ranking_chart", "width": 4}]})

    if has_trend:
        components.append({
            "id": "trend_chart", "type": "chart", "title": "Remediation Trend",
            "dataRef": "get_remediation_trend.trend",
            "chart": {
                "chartType": "line", "xKey": "month",
                "series": ["discovered", "remediated", "past_due", "escalated"],
            },
        })
        rows.append({"columns": [{"componentId": "trend_chart", "width": 4}]})

    if has_records:
        components.append({
            "id": "records_table", "type": "table", "title": "Matching Vulnerabilities",
            "dataRef": "get_vulnerability_records.records",
            "columns": _RECORD_TABLE_COLUMNS,
        })
        rows.append({"columns": [{"componentId": "records_table", "width": 4}]})

    # Own full-width row, after every chart/table but before the
    # filter form - matches the legacy Dashboard.tsx's DownloadCard
    # placement. "export" already exists verbatim inside the summary
    # tool's own payload (file_name/download_url/record_count) - no
    # new synthetic ui_data entry needed, just a dataRef straight into it.
    if has_summary and (summary.get("export") or {}).get("download_url"):
        components.append({
            "id": "download_card", "type": "download",
            "title": "Download Vulnerability Report",
            "dataRef": "get_vulnerability_summary.export",
        })
        rows.append({"columns": [{"componentId": "download_card", "width": 4}]})

    if has_summary or has_records:
        components.append({
            "id": "filters_form", "type": "input_form", "title": "Refine results",
            "formId": "vulnerability_filters", "dataRef": "_filters",
        })
        rows.append({"columns": [{"componentId": "filters_form", "width": 4}]})

    return {"layout": {"rows": rows}, "components": components}


class _AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    dashboard: dict[str, Any] | None
    records_table: dict[str, Any] | None
    # Additive declarative-rendering counterpart to dashboard/
    # records_table above - see the module docstring's "declarative UI
    # description" section.
    ui_data: dict[str, Any] | None
    ui_spec: dict[str, Any] | None


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
        turn = _turn_messages(state["messages"])

        if _had_unresolved_entity(turn):
            return {
                "dashboard": None, "records_table": None,
                "ui_data": None, "ui_spec": None,
            }

        called_search = any(name in _SEARCH_TOOLS for name, _, _ in _iter_tool_calls(turn))
        called_records = any(
            name == "get_vulnerability_records" for name, _, _ in _iter_tool_calls(turn)
        )
        called_any = called_search or called_records

        # A None result is ambiguous between "this turn never searched
        # at all" (a pure follow-up - keep showing whatever was there
        # before) and "this turn DID search but matched zero rows"
        # (clear it - a stale non-empty dashboard/table would contradict
        # the "0 results" text response). called_search/called_records
        # disambiguate which case applies, independently for each panel
        # since a turn can call one tool without the other.
        update: dict[str, Any] = {}

        dashboard = _build_dashboard(turn)
        if dashboard is not None:
            update["dashboard"] = dashboard
        elif called_search:
            update["dashboard"] = None

        # The records panel is for a PURE listing turn (no analytics
        # dashboard). The model is instructed to call
        # get_vulnerability_records only for that case, but it isn't
        # perfectly reliable about it - so this is enforced
        # deterministically here too: whenever this turn produced a
        # dashboard, the records panel never shows alongside it, even
        # if get_vulnerability_records also got called.
        if dashboard is not None:
            update["records_table"] = None
        else:
            records_table = _build_records_table(turn)
            if records_table is not None:
                update["records_table"] = records_table
            elif called_records:
                update["records_table"] = None

        # ui_data/ui_spec are additive and independent of dashboard/
        # records_table above (not mutually exclusive with them) - same
        # clear-vs-preserve logic, just keyed off whether ANY relevant
        # tool was called this turn rather than splitting by panel,
        # since a single ui_spec can include both analytics and a
        # records table together.
        ui_data = _build_ui_data(turn)
        ui_spec = _build_ui_spec(ui_data)
        if ui_spec is not None:
            update["ui_data"] = ui_data
            update["ui_spec"] = ui_spec
        elif called_any:
            update["ui_data"] = None
            update["ui_spec"] = None

        return update

    graph = StateGraph(_AgentState)
    graph.add_node("inner", call_inner)
    graph.add_node("build_dashboard", build_dashboard_node)
    graph.set_entry_point("inner")
    graph.add_edge("inner", "build_dashboard")
    graph.add_edge("build_dashboard", END)
    return graph


# The vulnerability-query tools that need an authenticated caller
# identity for access control (see vulnerability_mcp's
# VulnerabilityRepository - it ANDs an authorization condition into
# the query whenever employee_id is set). Entity-lookup tools
# (resolve_application, resolve_user, list_applications, list_users)
# aren't gated - those just resolve names to IDs without exposing
# vulnerability data.
_IDENTITY_INJECTED_TOOLS = {
    "get_vulnerability_summary",
    "get_vulnerability_records",
    "get_risk_ranking",
    "get_remediation_trend",
}


def _with_injected_identity(tool: BaseTool) -> BaseTool:
    """Wrap an MCP tool so every call deterministically carries the
    current request's authenticated employee_id, overwriting whatever
    (if anything) the LLM supplied for that argument - this is a
    security-relevant parameter and must never depend on the model
    choosing to pass, or not override, it correctly.
    """
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
    """Create a fresh ReAct agent with the MCP tools loaded, wrapped with
    the deterministic dashboard-building node described above.

    Backed by an in-memory checkpointer keyed on thread_id, so multi-turn
    conversations (filter refinements, follow-up questions) retain prior
    tool results and applied filters instead of starting over each turn.
    """
    mcp_tools = await mcp_client.get_tools()
    mcp_tools = [_with_injected_identity(t) for t in mcp_tools]
    llm = build_llm()
    inner_agent = create_react_agent(llm, mcp_tools, prompt=SYSTEM_PROMPT)
    graph = _build_graph(inner_agent)
    return graph.compile(checkpointer=MemorySaver())
