"""Deterministic composers: MCP tool output -> display rows.

Each composer is registered against a tool name. When the agent finishes
a turn, the presenter looks up a composer for every tool that ran and,
if found, builds rows deterministically (fast, predictable, no LLM).

Extending:
    @register_composer("my_new_tool")
    def compose_my_new_tool(output: dict, ctx: ComposeContext) -> list[DisplayRow]:
        ...
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable

from .elements import (
    CHART_COLORS,
    ChartElement,
    ChartSeries,
    DisplayRow,
    DownloadElement,
    FilterField,
    FilterOption,
    FilterPanelElement,
    StatItem,
    StatsElement,
    TableColumn,
    TableElement,
    row,
)

logger = logging.getLogger(__name__)


@dataclass
class ComposeContext:
    """Context handed to every composer."""

    user_query: str = ""
    tool_args: dict[str, Any] = field(default_factory=dict)  # filters the agent applied


ComposerFn = Callable[[dict, ComposeContext], "list[DisplayRow]"]

_REGISTRY: dict[str, ComposerFn] = {}


def register_composer(tool_name: str) -> Callable[[ComposerFn], ComposerFn]:
    def decorator(fn: ComposerFn) -> ComposerFn:
        _REGISTRY[tool_name] = fn
        return fn

    return decorator


def get_composer(tool_name: str) -> ComposerFn | None:
    return _REGISTRY.get(tool_name)


def compose_tool_result(
    tool_name: str, output: Any, ctx: ComposeContext
) -> list[DisplayRow] | None:
    """Run the registered composer, or None if no rule matches. Composer
    errors are swallowed (logged) so the presenter can fall back to LLM."""
    fn = _REGISTRY.get(tool_name)
    if fn is None or not isinstance(output, dict):
        return None
    try:
        return fn(output, ctx)
    except Exception:  # noqa: BLE001 - fall back rather than fail the turn
        logger.exception("Composer for %s failed; falling back", tool_name)
        return None


# --------------------------------------------------------------------------
# Shared helpers
# --------------------------------------------------------------------------

SEVERITY_ORDER = ["critical", "high", "medium", "low"]
SEVERITY_COLORS = {
    "critical": "var(--chart-1)",
    "high": "var(--chart-2)",
    "medium": "var(--chart-3)",
    "low": "var(--chart-4)",
}


def _breakdown_data(breakdown: dict[str, int], name_key: str = "name") -> list[dict]:
    items = sorted(breakdown.items(), key=lambda kv: kv[1], reverse=True)
    return [{name_key: k, "count": v} for k, v in items]


def build_filter_panel(applied: dict[str, Any]) -> FilterPanelElement:
    """Filter panel reflecting the filters the agent actually applied,
    plus the common editable controls."""
    applied = {k: v for k, v in (applied or {}).items() if v not in (None, [], "")}

    def val(key: str) -> Any:
        return applied.get(key)

    fields = [
        FilterField(
            id="severity",
            label="Severity",
            control="multiselect",
            options=[FilterOption(value=s, label=s.title()) for s in SEVERITY_ORDER],
            value=val("severity"),
        ),
        FilterField(id="is_past_due", label="Past due", control="toggle", value=val("is_past_due")),
        FilterField(id="is_escalated", label="Escalated", control="toggle", value=val("is_escalated")),
        FilterField(
            id="is_internet_facing",
            label="Internet-facing",
            control="toggle",
            value=val("is_internet_facing"),
        ),
        FilterField(
            id="operating_system",
            label="Operating system",
            control="multiselect",
            options=[FilterOption(value=v) for v in ("Linux", "Windows", "Unix")],
            value=val("operating_system"),
        ),
        FilterField(
            id="environment",
            label="Environment",
            control="multiselect",
            options=[FilterOption(value=v) for v in ("prod", "uat", "dev")],
            value=val("environment"),
        ),
        FilterField(
            id="application_names", label="Applications", control="text", value=val("application_names")
        ),
        FilterField(
            id="business_unit", label="Business unit", control="text", value=val("business_unit")
        ),
        FilterField(
            id="discovered",
            label="Discovered between",
            control="daterange",
            value={
                "after": val("discovered_after"),
                "before": val("discovered_before"),
            }
            if (val("discovered_after") or val("discovered_before"))
            else None,
        ),
        FilterField(
            id="remediation_due",
            label="Remediation due between",
            control="daterange",
            value={
                "after": val("remediation_due_after"),
                "before": val("remediation_due_before"),
            }
            if (val("remediation_due_after") or val("remediation_due_before"))
            else None,
        ),
    ]
    return FilterPanelElement(title="Filters", fields=fields)


# --------------------------------------------------------------------------
# Per-tool composers
# --------------------------------------------------------------------------


@register_composer("get_vulnerability_summary")
def compose_summary(output: dict, ctx: ComposeContext) -> list[DisplayRow]:
    summary = output.get("summary", {})
    breakdowns = output.get("breakdowns", {})
    export = output.get("export", {})
    rows: list[DisplayRow] = []

    total = summary.get("total_vulnerabilities", 0)
    stats = StatsElement(
        items=[
            StatItem(label="Total vulnerabilities", value=total),
            StatItem(
                label="Past due",
                value=summary.get("total_past_due", 0),
                intent="danger" if summary.get("total_past_due") else "default",
            ),
            StatItem(
                label="Escalated",
                value=summary.get("total_escalated", 0),
                intent="warning" if summary.get("total_escalated") else "default",
            ),
            StatItem(
                label="Internet-facing",
                value=summary.get("total_internet_facing", 0),
                intent="warning" if summary.get("total_internet_facing") else "default",
            ),
            StatItem(label="Exploitable", value=summary.get("total_exploitable", 0)),
        ]
    )
    rows.append(row(stats, id="summary-stats"))

    charts = []
    severity = breakdowns.get("severity_breakdown") or {}
    if severity:
        data = [
            {"name": s, "count": severity.get(s, 0)}
            for s in SEVERITY_ORDER
            if s in severity
        ] or _breakdown_data(severity)
        charts.append(
            ChartElement(
                variant="donut",
                title="By severity",
                x_key="name",
                data=data,
                series=[ChartSeries(key="count", label="Findings")],
            )
        )
    os_breakdown = breakdowns.get("os_breakdown") or {}
    if os_breakdown:
        charts.append(
            ChartElement(
                variant="bar",
                title="By operating system",
                x_key="name",
                data=_breakdown_data(os_breakdown)[:8],
                series=[ChartSeries(key="count", label="Findings", color=CHART_COLORS[1])],
            )
        )
    app_breakdown = breakdowns.get("application_breakdown") or {}
    if app_breakdown:
        charts.append(
            ChartElement(
                variant="bar",
                title="Top applications",
                x_key="name",
                horizontal=True,
                data=_breakdown_data(app_breakdown)[:10],
                series=[ChartSeries(key="count", label="Findings", color=CHART_COLORS[2])],
            )
        )
    if charts[:2]:
        rows.append(row(*charts[:2], id="summary-charts"))
    if charts[2:]:
        rows.append(row(*charts[2:], id="summary-charts-2"))

    if export.get("download_url"):
        rows.append(
            row(
                DownloadElement(
                    title="Full vulnerability export",
                    file_name=export.get("file_name", "export.csv"),
                    url=export["download_url"],
                    record_count=export.get("record_count"),
                    description="CSV containing every matching record.",
                ),
                id="summary-export",
            )
        )

    rows.append(row(build_filter_panel(ctx.tool_args), id="summary-filters"))
    return rows


@register_composer("get_risk_ranking")
def compose_risk_ranking(output: dict, ctx: ComposeContext) -> list[DisplayRow]:
    ranking = output.get("ranking") or []
    dimension = (output.get("dimension") or "application").replace("_", " ")
    data = [
        {"name": e.get("name"), "risk_score": e.get("risk_score"), "total_findings": e.get("total_findings")}
        for e in ranking
    ]
    chart = ChartElement(
        variant="bar",
        title=f"Riskiest {dimension}s",
        description="Composite risk score (severity, past-due, escalation, exposure)",
        x_key="name",
        horizontal=True,
        height=max(240, 34 * len(data) + 60),
        data=data,
        series=[ChartSeries(key="risk_score", label="Risk score", color=CHART_COLORS[0])],
    )
    table = TableElement(
        title=f"Ranking by {dimension}",
        columns=[
            TableColumn(key="name", label=dimension.title()),
            TableColumn(key="risk_score", label="Risk score", format="number"),
            TableColumn(key="total_findings", label="Findings", format="number"),
        ],
        rows=data,
    )
    return [row(chart, table, spans=[7, 5], id="risk-ranking")]


@register_composer("get_remediation_trend")
def compose_trend(output: dict, ctx: ComposeContext) -> list[DisplayRow]:
    trend = output.get("trend") or []
    chart = ChartElement(
        variant="line",
        title="Remediation trend",
        description="Monthly discovered vs remediated, past due and escalated",
        x_key="month",
        height=320,
        data=trend,
        series=[
            ChartSeries(key="discovered", label="Discovered", color=CHART_COLORS[0]),
            ChartSeries(key="remediated", label="Remediated", color=CHART_COLORS[1]),
            ChartSeries(key="past_due", label="Past due", color=CHART_COLORS[2]),
            ChartSeries(key="escalated", label="Escalated", color=CHART_COLORS[3]),
        ],
    )
    return [row(chart, id="remediation-trend")]


@register_composer("get_vulnerability_records")
def compose_records(output: dict, ctx: ComposeContext) -> list[DisplayRow]:
    records = output.get("records") or []
    table = TableElement(
        title=f"Matching records ({output.get('query_metadata', {}).get('records_matched', len(records))} matched)",
        columns=[
            TableColumn(key="vulnerability_id", label="ID"),
            TableColumn(key="hostname", label="Host"),
            TableColumn(key="application_name", label="Application"),
            TableColumn(key="severity", label="Severity", format="badge"),
            TableColumn(key="cve_id", label="CVE"),
            TableColumn(key="past_due_flag", label="Past due", format="boolean"),
            TableColumn(key="escalated_flag", label="Escalated", format="boolean"),
            TableColumn(key="due_date", label="Due", format="date"),
        ],
        rows=records,
    )
    return [
        row(table, id="records-table"),
        row(build_filter_panel(ctx.tool_args), id="records-filters"),
    ]
