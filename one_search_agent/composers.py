"""Display-element composers: turn the trusted `ui_data` registry
(verbatim MCP tool results - see agent.py's `_build_ui_data`) into the
declarative `ui_spec` the frontend renders (rows of typed display
elements: markdown / chart / table / kpi / download / input_form).

Hybrid architecture:

- DETERMINISTIC (default): `DETERMINISTIC_COMPOSERS` is an ordered
  registry of small functions, each responsible for one slice of
  `ui_data` (the access summary, the KPI tiles, the breakdown donuts,
  the records table, ...). Each returns its components + layout rows,
  or None when its data isn't present this turn. Supporting a new MCP
  tool = appending one function here - nothing else changes.

- LLM (opt-in via COMPOSER_MODE=llm): a schema-constrained model call
  picks WHICH elements to use and how to arrange them - but every
  chart/table element still only carries a `dataRef` path into
  `ui_data` (validated to resolve before acceptance), so the LLM can
  choose presentation, never alter data. Any failure falls back to the
  deterministic registry for that turn.

- HYBRID (COMPOSER_MODE=hybrid): deterministic first; the LLM only
  composes when the registry produced nothing for this turn's data -
  i.e. it's the extension path for tool outputs no deterministic
  composer covers yet.

Data-trust invariant (all modes): chart/table/kpi/download/input_form
elements reference tool data by `dataRef` (a dotted path into ui_data,
e.g. "get_vulnerability_summary.breakdowns.severity_breakdown") and
never embed values; only `markdown` elements carry literal text.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Callable, Literal

from langchain_core.language_models.chat_models import BaseChatModel
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# A composer contributes (components, layout rows) or None when its
# slice of ui_data is absent this turn.
Block = tuple[list[dict[str, Any]], list[dict[str, Any]]]
Composer = Callable[[dict[str, Any]], "Block | None"]


def _full_row(component_id: str) -> dict[str, Any]:
    return {"columns": [{"componentId": component_id, "width": 4}]}


# ---------------------------------------------------------------------------
# Deterministic composers - one per slice of ui_data
# ---------------------------------------------------------------------------
def _summary(ui_data: dict[str, Any]) -> dict[str, Any] | None:
    summary = ui_data.get("get_vulnerability_summary")
    if not summary:
        return None
    total = (summary.get("summary") or {}).get("total_vulnerabilities", 0)
    return summary if total > 0 else None


def compose_access_summary(ui_data: dict[str, Any]) -> Block | None:
    """Markdown panel summarizing the user's effective access - built
    verbatim from get_user_access's trusted counts, no LLM."""
    access = ui_data.get("get_user_access")
    if not access:
        return None

    if not access.get("authenticated"):
        md = (
            "#### No authenticated identity\n"
            "No `X-Employee-Id` reached the agent, so searches run "
            "**unrestricted** (local development mode)."
        )
        return (
            [{"id": "access_summary", "type": "markdown", "markdown": md}],
            [_full_row("access_summary")],
        )

    employee = access.get("employee") or {}
    name = " ".join(v for v in (employee.get("first_name"), employee.get("last_name")) if v)
    lines = [f"#### Your vulnerability access — {name or employee.get('ecn', '')}"]

    app = access.get("application_access") or {}
    if app.get("application_count"):
        app_names = ", ".join(
            a.get("application_name", a.get("application_id", "?"))
            for a in (app.get("owned_applications") or [])[:6]
        )
        more = app.get("application_count", 0) - min(6, len(app.get("owned_applications") or []))
        suffix = f" (+{more} more)" if more > 0 else ""
        lines.append(
            f"- **Applications you own:** {app['application_count']} "
            f"({app_names}{suffix}) — {app.get('vulnerability_count', 0)} findings"
        )

    infra = access.get("infrastructure_access") or {}
    if infra.get("vulnerability_count"):
        lines.append(
            f"- **Infrastructure you own:** {infra.get('asset_count', 0)} assets — "
            f"{infra['vulnerability_count']} findings"
        )

    for d in access.get("delegations") or []:
        delegator = d.get("delegator") or {}
        d_name = " ".join(
            v for v in (delegator.get("first_name"), delegator.get("last_name")) if v
        ) or delegator.get("ecn", "?")
        counts = []
        if "application_vulnerability_count" in d:
            counts.append(f"{d['application_vulnerability_count']} application findings")
        if "infrastructure_vulnerability_count" in d:
            counts.append(f"{d['infrastructure_vulnerability_count']} infrastructure findings")
        lines.append(
            f"- **Delegated by {d_name}** ({delegator.get('ecn', '?')}) — "
            f"{d.get('scope', '?')} scope: {', '.join(counts) if counts else 'no findings'}"
        )

    if access.get("is_admin"):
        groups = ", ".join(access.get("admin_groups") or [])
        lines.append(f"- **Admin access:** member of {groups} — you can see *all* vulnerabilities")

    lines.append(
        f"\n**Total findings visible to you: "
        f"{access.get('total_visible_vulnerabilities', 0)}**"
    )
    return (
        [{"id": "access_summary", "type": "markdown", "markdown": "\n".join(lines)}],
        [_full_row("access_summary")],
    )


def compose_kpis(ui_data: dict[str, Any]) -> Block | None:
    if "_kpis" not in ui_data:
        return None
    return (
        [{"id": "kpi_summary", "type": "kpi", "dataRef": "_kpis"}],
        [_full_row("kpi_summary")],
    )


def compose_breakdown_donuts(ui_data: dict[str, Any]) -> Block | None:
    """The 4 yes/no-or-categorical donuts, sharing one row."""
    summary = _summary(ui_data)
    if not summary:
        return None
    breakdowns = summary.get("breakdowns") or {}

    components: list[dict[str, Any]] = []
    if breakdowns.get("severity_breakdown"):
        components.append({
            "id": "severity_chart", "type": "chart", "title": "Findings by Severity",
            "dataRef": "get_vulnerability_summary.breakdowns.severity_breakdown",
            "chart": {"chartType": "donut"},
        })
    if breakdowns.get("internet_facing_breakdown"):
        components.append({
            "id": "internet_facing_chart", "type": "chart", "title": "Internet Facing",
            "dataRef": "get_vulnerability_summary.breakdowns.internet_facing_breakdown",
            "chart": {"chartType": "donut"},
        })
    if "_past_due_breakdown" in ui_data:
        components.append({
            "id": "past_due_chart", "type": "chart", "title": "Past Due",
            "dataRef": "_past_due_breakdown", "chart": {"chartType": "donut"},
        })
    if "_exploitable_breakdown" in ui_data:
        components.append({
            "id": "exploitable_chart", "type": "chart", "title": "Exploitable",
            "dataRef": "_exploitable_breakdown", "chart": {"chartType": "donut"},
        })
    if not components:
        return None
    row = {"columns": [{"componentId": c["id"], "width": 1} for c in components]}
    return components, [row]


def compose_severity_bar(ui_data: dict[str, Any]) -> Block | None:
    summary = _summary(ui_data)
    if not summary or not (summary.get("breakdowns") or {}).get("severity_breakdown"):
        return None
    component = {
        "id": "severity_bar_chart", "type": "chart", "title": "Inherent Risk Count",
        "dataRef": "get_vulnerability_summary.breakdowns.severity_breakdown",
        "chart": {"chartType": "bar"},
    }
    return [component], [_full_row("severity_bar_chart")]


def compose_platform_bar(ui_data: dict[str, Any]) -> Block | None:
    summary = _summary(ui_data)
    if not summary or not (summary.get("breakdowns") or {}).get("finding_category_breakdown"):
        return None
    component = {
        "id": "platform_chart", "type": "chart", "title": "Findings by Platform",
        "dataRef": "get_vulnerability_summary.breakdowns.finding_category_breakdown",
        "chart": {"chartType": "bar"},
    }
    return [component], [_full_row("platform_chart")]


def compose_risk_ranking(ui_data: dict[str, Any]) -> Block | None:
    ranking = ui_data.get("get_risk_ranking")
    if not ranking or not ranking.get("ranking"):
        return None
    component = {
        "id": "ranking_chart", "type": "chart",
        "title": f"Top {ranking.get('dimension', 'application')} by risk",
        "dataRef": "get_risk_ranking.ranking",
        "chart": {"chartType": "horizontalBar", "xKey": "name", "series": ["risk_score"]},
    }
    return [component], [_full_row("ranking_chart")]


def compose_remediation_trend(ui_data: dict[str, Any]) -> Block | None:
    trend = ui_data.get("get_remediation_trend")
    if not trend or not trend.get("trend"):
        return None
    component = {
        "id": "trend_chart", "type": "chart", "title": "Remediation Trend",
        "dataRef": "get_remediation_trend.trend",
        "chart": {
            "chartType": "line", "xKey": "month",
            "series": ["discovered", "remediated", "past_due", "escalated"],
        },
    }
    return [component], [_full_row("trend_chart")]


# "key" is the RAW field name verbatim from the records tool's rows -
# the table binds straight to ui_data without renaming; only "label"
# (the header text) is presentation metadata.
RECORD_TABLE_COLUMNS: list[dict[str, str]] = [
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


def compose_records_table(ui_data: dict[str, Any]) -> Block | None:
    records = ui_data.get("get_vulnerability_records")
    if not records or not records.get("records"):
        return None
    component = {
        "id": "records_table", "type": "table", "title": "Matching Vulnerabilities",
        "dataRef": "get_vulnerability_records.records",
        "columns": RECORD_TABLE_COLUMNS,
    }
    return [component], [_full_row("records_table")]


def compose_download(ui_data: dict[str, Any]) -> Block | None:
    summary = _summary(ui_data)
    if not summary or not (summary.get("export") or {}).get("download_url"):
        return None
    component = {
        "id": "download_card", "type": "download",
        "title": "Download Vulnerability Report",
        "dataRef": "get_vulnerability_summary.export",
    }
    return [component], [_full_row("download_card")]


def compose_filters_form(ui_data: dict[str, Any]) -> Block | None:
    has_results = _summary(ui_data) is not None or bool(
        (ui_data.get("get_vulnerability_records") or {}).get("records")
    )
    if not has_results or "_filters" not in ui_data:
        return None
    component = {
        "id": "filters_form", "type": "input_form", "title": "Refine results",
        "formId": "vulnerability_filters", "dataRef": "_filters",
    }
    return [component], [_full_row("filters_form")]


# Ordered registry - order here IS the on-screen top-to-bottom order.
# Extending the system with a new tool = adding one function above and
# one entry here.
DETERMINISTIC_COMPOSERS: list[Composer] = [
    compose_access_summary,
    compose_kpis,
    compose_breakdown_donuts,
    compose_severity_bar,
    compose_platform_bar,
    compose_risk_ranking,
    compose_remediation_trend,
    compose_records_table,
    compose_download,
    compose_filters_form,
]


def compose_deterministic(ui_data: dict[str, Any]) -> dict[str, Any] | None:
    components: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    for composer in DETERMINISTIC_COMPOSERS:
        block = composer(ui_data)
        if block:
            c, r = block
            components.extend(c)
            rows.extend(r)
    if not components:
        return None
    return {"layout": {"rows": rows}, "components": components}


# ---------------------------------------------------------------------------
# LLM composer - presentation choices only, dataRef-validated
# ---------------------------------------------------------------------------
class _LLMElement(BaseModel):
    """One display element the model may emit. Chart/table/kpi/download/
    input_form elements bind data exclusively via dataRef - the model
    cannot embed values for them."""

    id: str
    type: Literal["markdown", "chart", "table", "kpi", "download", "input_form"]
    title: str | None = None
    dataRef: str | None = Field(
        default=None,
        description="Dotted path into the trusted dataset registry, e.g. "
        "'get_vulnerability_summary.breakdowns.severity_breakdown'. REQUIRED "
        "for every type except markdown.",
    )
    chartType: Literal["bar", "horizontalBar", "pie", "donut", "line"] | None = None
    xKey: str | None = None
    series: list[str] | None = None
    markdown: str | None = Field(
        default=None, description="markdown type only - narrative text."
    )
    formId: Literal["vulnerability_filters"] | None = None


class _LLMRow(BaseModel):
    elementIds: list[str] = Field(description="ids of elements sharing this row, left to right")


class _LLMLayout(BaseModel):
    rows: list[_LLMRow]
    elements: list[_LLMElement]


def _resolves(ui_data: dict[str, Any], data_ref: str) -> bool:
    current: Any = ui_data
    for segment in data_ref.split("."):
        if not isinstance(current, dict) or segment not in current:
            return False
        current = current[segment]
    return True


def _llm_layout_to_ui_spec(
    layout: _LLMLayout, ui_data: dict[str, Any]
) -> dict[str, Any] | None:
    components: list[dict[str, Any]] = []
    for el in layout.elements:
        if el.type == "markdown":
            if not el.markdown:
                return None
            component: dict[str, Any] = {
                "id": el.id, "type": "markdown", "markdown": el.markdown,
            }
        else:
            # Every non-markdown element must reference REAL data.
            if not el.dataRef or not _resolves(ui_data, el.dataRef):
                logger.warning("LLM composer emitted unresolvable dataRef %r", el.dataRef)
                return None
            component = {"id": el.id, "type": el.type, "dataRef": el.dataRef}
            if el.type == "chart":
                if not el.chartType:
                    return None
                chart: dict[str, Any] = {"chartType": el.chartType}
                if el.xKey:
                    chart["xKey"] = el.xKey
                if el.series:
                    chart["series"] = el.series
                component["chart"] = chart
            if el.type == "table":
                component["columns"] = RECORD_TABLE_COLUMNS
            if el.type == "input_form":
                component["formId"] = el.formId or "vulnerability_filters"
        if el.title:
            component["title"] = el.title
        components.append(component)

    ids = {c["id"] for c in components}
    rows = []
    for row in layout.rows:
        cells = [
            {"componentId": eid, "width": 1}
            for eid in row.elementIds
            if eid in ids
        ]
        if cells:
            rows.append({"columns": cells})
    if not components or not rows:
        return None
    return {"layout": {"rows": rows}, "components": components}


def _bindable_paths(ui_data: dict[str, Any]) -> dict[str, str]:
    """Enumerate every dataRef path a chart/table/kpi could bind to,
    mapped to a short shape hint - so the LLM CHOOSES from real paths
    instead of guessing them (guessed paths are rejected anyway by
    _resolves, but offering the exact menu makes the LLM path succeed
    far more often). Only paths pointing at a scalar-valued dict
    (breakdown maps) or a list (records/ranking/trend/kpis) are
    bindable - nested container dicts are traversed, not offered.
    """
    paths: dict[str, str] = {}

    def walk(value: Any, prefix: str, depth: int) -> None:
        if isinstance(value, list):
            item = value[0] if value else None
            if isinstance(item, dict):
                paths[prefix] = f"list of {len(value)} objects, fields: {list(item.keys())}"
            else:
                paths[prefix] = f"list of {len(value)} values"
            return
        if isinstance(value, dict):
            scalar_only = all(not isinstance(v, (dict, list)) for v in value.values())
            if value and scalar_only:
                paths[prefix] = f"category->count map, keys: {list(value.keys())}"
                return
            if depth >= 3:
                return
            for k, v in value.items():
                child = f"{prefix}.{k}" if prefix else k
                walk(v, child, depth + 1)

    for key, value in ui_data.items():
        walk(value, key, 0)
    return paths


async def compose_with_llm(
    ui_data: dict[str, Any], llm: BaseChatModel
) -> dict[str, Any] | None:
    """Ask the model to pick and arrange display elements for this
    turn's data. Returns None on any failure - callers fall back to
    the deterministic registry, so a flaky generation can never leave
    the user without a rendering."""
    # The model is handed the EXACT menu of bindable dataRef paths (plus
    # a shape hint each) and binds via dataRef, so it physically cannot
    # restate or alter the numbers - only choose which trusted path to
    # visualize and how.
    paths = _bindable_paths(ui_data)
    try:
        structured = llm.with_structured_output(_LLMLayout, method="function_calling")
        layout = await structured.ainvoke(
            "You are composing a security-analytics screen out of typed display "
            "elements, each rendered by the UI from trusted data it binds via "
            "dataRef. Element types: 'markdown' (short narrative text you write - "
            "the ONLY type carrying literal content), 'chart' (set chartType: "
            "donut/pie for category->count maps or yes/no splits, bar for "
            "category counts, horizontalBar for ranked lists, line for time "
            "series; for list-of-object data set xKey/series to field names "
            "from the shape hint), 'table' (dataRef pointing at a records list), "
            "'kpi' (dataRef '_kpis' if present), 'download' (dataRef "
            "'get_vulnerability_summary.export' if present), 'input_form' "
            "(formId 'vulnerability_filters', dataRef '_filters' if present). "
            "Arrange elements into rows top-to-bottom; put related small charts "
            "side by side in one row (max 4), give tables/forms/kpis their own "
            "row. If a get_user_access entry is present, lead with a short "
            "markdown welcome summarizing the user's access. You MUST set every "
            "non-markdown element's dataRef to one of the EXACT paths listed "
            "below - never invent a path, never restate numbers in markdown.\n\n"
            "Bindable dataRef paths (path: shape):\n"
            + json.dumps(paths, indent=2, default=str)
        )
    except Exception:
        logger.exception("LLM composer call failed; falling back to deterministic")
        return None

    try:
        return _llm_layout_to_ui_spec(layout, ui_data)
    except Exception:
        logger.exception("LLM composer output invalid; falling back to deterministic")
        return None


# ---------------------------------------------------------------------------
# Mode dispatch
# ---------------------------------------------------------------------------
async def compose_ui_spec(
    ui_data: dict[str, Any] | None,
    mode: str = "deterministic",
    llm: BaseChatModel | None = None,
) -> dict[str, Any] | None:
    """Entry point: ui_data -> ui_spec under the configured mode.

    - deterministic: registry only.
    - llm: LLM arranges every turn; deterministic on failure.
    - hybrid: deterministic first; LLM only when the registry produced
      nothing (i.e. this turn's data has no deterministic coverage).
    """
    if not ui_data:
        return None

    if mode == "llm" and llm is not None:
        spec = await compose_with_llm(ui_data, llm)
        if spec is not None:
            return spec
        return compose_deterministic(ui_data)

    deterministic = compose_deterministic(ui_data)
    if mode == "hybrid" and deterministic is None and llm is not None:
        # Only reachable for data no deterministic composer covers -
        # the extension path for newly-added tools.
        meaningful = {k: v for k, v in ui_data.items() if k != "_filters"}
        if meaningful:
            return await compose_with_llm(ui_data, llm)
    return deterministic
