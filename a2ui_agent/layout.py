"""Row-based layout: the LLM's constrained output, plus a deterministic
compiler that turns it into the a2ui.org component tree.

The LLM no longer hand-builds the a2ui component tree (nested
Rows/Columns/Cards with matching child ids - the source of dangling
"[Loading...]" refs and half-built KPIs). Instead it outputs a simple
LIST OF ROWS, each row a list of typed display elements
(markdown / kpi / chart / table / download / filter). Python then:

  1. Enforces placement rules - table, download, and filter each take a
     full row of their own and are never combined with other content.
  2. Injects TRUSTED data for table/download/filter from the actual tool
     results (the LLM never restates record rows, the export URL, or
     filter option lists).
  3. Deterministically expands the rows into the a2ui component tree
     (see `compile_layout`), so the tree is always valid by construction
     - no dangling references, correct weights, rules guaranteed.

The LLM still decides WHICH rows, what goes in each, chart configs, and
markdown narration - just not the low-level tree mechanics.
"""
from __future__ import annotations

from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Field

from a2ui_schema import ROOT_ID

# --- Filter panel definition (static; injected into filter elements) ---
# Kept simple/self-contained - a2ui_ui has no entity-lookup API, so no
# searchable dropdowns here (unlike one_search_ui).
FILTER_FIELDS: list[dict[str, Any]] = [
    {"name": "severity", "label": "Severity", "component": "multiSelect",
     "options": ["Critical", "High", "Medium", "Low"]},
    {"name": "environment", "label": "Environment", "component": "multiSelect",
     "options": ["Production", "Staging", "Development"]},
    {"name": "operatingSystem", "label": "Operating System", "component": "multiSelect",
     "options": ["RHEL 8", "Ubuntu 22.04", "Windows Server 2019", "Windows Server 2022",
                 "AIX 7.2", "Solaris 11"]},
    {"name": "businessUnit", "label": "Business Unit", "component": "text"},
    {"name": "region", "label": "Region", "component": "text"},
    {"name": "isPastDue", "label": "Past Due", "component": "checkbox"},
    {"name": "isEscalated", "label": "Escalated", "component": "checkbox"},
    {"name": "internetFacing", "label": "Internet Facing", "component": "checkbox"},
]

# Maps get_vulnerability_summary request args to filter field names, so a
# filter panel can reflect the currently-applied filters.
ARG_TO_FILTER_FIELD = {
    "severity": "severity",
    "environment": "environment",
    "operating_system": "operatingSystem",
    "business_unit": "businessUnit",
    "regions": "region",
    "is_past_due": "isPastDue",
    "is_escalated": "isEscalated",
    "is_internet_facing": "internetFacing",
}

# Records table columns: "key" is the RAW field name from the records
# tool's rows (bound verbatim, no renaming); "label" is display only.
RECORD_COLUMNS: list[dict[str, str]] = [
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


# --- LLM output schema: rows of typed elements ---
class MarkdownElement(BaseModel):
    type: Literal["markdown"]
    text: str = Field(description="Short narration/insight in markdown.")


class KpiElement(BaseModel):
    type: Literal["kpi"]
    label: str = Field(description="What the number means, e.g. 'Past Due'.")
    # PREFERRED: a dotted path to a trusted scalar in the tool results,
    # e.g. 'get_vulnerability_summary.summary.total_past_due'. When it
    # resolves, Python binds the real value and the tile is marked
    # trusted. Only fall back to `value` if no path fits.
    valueRef: str | None = Field(
        default=None, description="Dotted path to a trusted scalar (preferred over value)."
    )
    value: str | None = Field(
        default=None, description="Inline value ONLY if no valueRef path fits (untrusted)."
    )


class ChartElement(BaseModel):
    type: Literal["chart"]
    chartType: Literal["bar", "horizontalBar", "line", "pie", "donut"]
    title: str
    # PREFERRED: a dotted path to trusted data in the tool results, e.g.
    # 'get_vulnerability_summary.breakdowns.severity_breakdown' (a
    # category->count map) or 'get_risk_ranking.ranking' (a list). When
    # it resolves, Python binds the real data and the chart is marked
    # trusted - do NOT also fill data/xKey/series in that case.
    dataRef: str | None = Field(
        default=None, description="Dotted path to trusted data (preferred over inline data)."
    )
    # Inline fallback ONLY when no dataRef fits (chart is then untrusted):
    xKey: str | None = Field(default=None, description="Label field name (inline fallback).")
    series: list[str] | None = Field(default=None, description="Value field name(s) (inline).")
    data: list[dict[str, Any]] | None = Field(
        default=None, description="Inline data ONLY if no dataRef fits (untrusted)."
    )


class TableElement(BaseModel):
    """A records table. Rows/columns are injected by Python from
    get_vulnerability_records - only include this when the user asked to
    see individual findings and that tool was called."""

    type: Literal["table"]
    title: str | None = None


class DownloadElement(BaseModel):
    """A CSV download button. The URL is injected by Python from the
    summary export - only include when a summary was produced."""

    type: Literal["download"]
    label: str | None = None


class FilterElement(BaseModel):
    """The refine-results filter panel. Fields/values injected by
    Python."""

    type: Literal["filter"]


LayoutElement = Union[
    MarkdownElement, KpiElement, ChartElement, TableElement, DownloadElement, FilterElement
]
LayoutElementField = Annotated[LayoutElement, Field(discriminator="type")]


class LayoutRow(BaseModel):
    elements: list[LayoutElementField] = Field(
        description="One or more elements shown side by side in this row."
    )


class Layout(BaseModel):
    """The full screen: an ordered list of rows."""

    rows: list[LayoutRow]


# --- Deterministic compiler: Layout -> a2ui component list ---
# Elements that must occupy their own full-width row, never combined.
_SOLO_TYPES = {"table", "download", "filter"}


def _summary(tool_data: dict[str, Any]) -> dict[str, Any] | None:
    s = tool_data.get("get_vulnerability_summary")
    if not s:
        return None
    total = (s.get("summary") or {}).get("total_vulnerabilities", 0)
    return s if total > 0 else None


_MISSING = object()


def resolve_ref(tool_data: dict[str, Any], path: str) -> Any:
    """Resolve a dotted path into the trusted tool-result registry.
    Returns _MISSING if any segment doesn't exist."""
    cur: Any = tool_data
    for seg in path.split("."):
        if not isinstance(cur, dict) or seg not in cur:
            return _MISSING
        cur = cur[seg]
    return cur


def _chart_from_ref(
    resolved: Any, xkey: str | None, series: list[str] | None
) -> tuple[list[dict[str, Any]], str, list[str]] | None:
    """Turn a resolved reference into (data, xKey, series). A scalar map
    (category->count) becomes label/value pairs; a list of objects is
    used as-is with inferred/validated field names."""
    if isinstance(resolved, dict) and resolved and all(
        not isinstance(v, (dict, list)) for v in resolved.values()
    ):
        return [{"label": k, "value": v} for k, v in resolved.items()], "label", ["value"]
    if isinstance(resolved, list) and resolved and all(isinstance(r, dict) for r in resolved):
        keys = list(resolved[0].keys())
        xk = xkey if xkey in keys else keys[0]
        sr = [s for s in (series or []) if s in keys] or [k for k in keys if k != xk][:1]
        return resolved, xk, (sr or ["value"])
    return None


def bindable_paths(tool_data: dict[str, Any]) -> tuple[dict[str, str], list[str]]:
    """Enumerate the dataRef paths available this turn so the LLM chooses
    from real ones: (chart_paths {path: shape hint}, scalar_paths [path])
    for chart dataRef and KPI valueRef respectively."""
    chart_paths: dict[str, str] = {}
    scalar_paths: list[str] = []

    def walk(val: Any, prefix: str, depth: int) -> None:
        if isinstance(val, dict):
            scalar_only = bool(val) and all(not isinstance(v, (dict, list)) for v in val.values())
            if scalar_only:
                chart_paths[prefix] = f"category->count map, keys: {list(val.keys())[:8]}"
                for k, v in val.items():
                    scalar_paths.append(f"{prefix}.{k}")
                return
            if depth >= 3:
                return
            for k, v in val.items():
                walk(v, f"{prefix}.{k}" if prefix else k, depth + 1)
        elif isinstance(val, list) and val and isinstance(val[0], dict):
            chart_paths[prefix] = f"list of {len(val)} objects, fields: {list(val[0].keys())}"

    for key, val in tool_data.items():
        walk(val, key, 0)
    return chart_paths, scalar_paths[:40]


def compile_layout(
    layout: Layout, tool_data: dict[str, Any], applied_filters: dict[str, Any]
) -> list[dict[str, Any]] | None:
    """Turn the LLM's row layout into a valid a2ui component list.

    Enforces the placement rules (solo types get their own row), injects
    trusted data for table/download/filter, drops elements whose backing
    data isn't present, and builds the tree so it can never dangle.
    Returns None if nothing renderable remains.
    """
    components: list[dict[str, Any]] = []
    root_children: list[str] = []
    counter = 0

    def new_id(prefix: str) -> str:
        nonlocal counter
        counter += 1
        return f"{prefix}_{counter}"

    def build_element(el: Any) -> str | None:
        """Append the a2ui component(s) for one element; return its id, or
        None if it should be dropped (missing backing data)."""
        if el.type == "markdown":
            cid = new_id("md")
            components.append({"component": "Markdown", "id": cid, "text": el.text})
            return cid
        if el.type == "kpi":
            # Prefer a trusted scalar reference; fall back to inline value.
            value: str | None = None
            trusted = False
            if el.valueRef:
                resolved = resolve_ref(tool_data, el.valueRef)
                if resolved is not _MISSING and not isinstance(resolved, (dict, list)) \
                        and resolved is not None:
                    value, trusted = str(resolved), True
            if value is None and el.value is not None:
                value, trusted = el.value, False
            if value is None:
                return None
            cid = new_id("kpi")
            components.append({
                "component": "Kpi", "id": cid, "label": el.label,
                "value": value, "trusted": trusted,
            })
            return cid
        if el.type == "chart":
            # Prefer trusted data bound by reference; fall back to inline.
            data = xkey = series = None
            trusted = False
            if el.dataRef:
                resolved = resolve_ref(tool_data, el.dataRef)
                if resolved is not _MISSING:
                    built = _chart_from_ref(resolved, el.xKey, el.series)
                    if built:
                        data, xkey, series = built
                        trusted = True
            if data is None and el.data:
                data = el.data
                xkey = el.xKey or "label"
                series = el.series or ["value"]
                trusted = False
            if data is None:
                return None
            cid = new_id("chart")
            components.append({
                "component": "Chart", "id": cid, "chartType": el.chartType,
                "title": el.title, "xKey": xkey, "series": series,
                "data": data, "trusted": trusted,
            })
            return cid
        if el.type == "table":
            records = (tool_data.get("get_vulnerability_records") or {}).get("records")
            if not records:
                return None
            cid = new_id("table")
            components.append({
                "component": "Table", "id": cid,
                "title": el.title or "Matching Vulnerabilities",
                # Rows are injected verbatim from the records tool, so a
                # table is always trusted (never LLM-authored data).
                "columns": RECORD_COLUMNS, "rows": records, "trusted": True,
            })
            return cid
        if el.type == "download":
            summary = _summary(tool_data)
            export = (summary or {}).get("export") or {}
            url = export.get("download_url")
            if not url:
                return None
            count = export.get("record_count")
            cid = new_id("dl")
            components.append({
                "component": "DownloadLink", "id": cid, "url": url,
                "label": el.label or (
                    f"Download report ({count} findings)" if count is not None
                    else "Download report"
                ),
            })
            return cid
        if el.type == "filter":
            cid = new_id("filter")
            components.append({
                "component": "Filter", "id": cid,
                "fields": FILTER_FIELDS, "values": applied_filters,
            })
            return cid
        return None

    def emit_row(elements: list[Any]) -> None:
        ids = [i for i in (build_element(e) for e in elements) if i is not None]
        if not ids:
            return
        if len(ids) == 1:
            root_children.append(ids[0])
            return
        for cid in ids:
            # even split across the row for the a2ui Row flex layout
            comp = next(c for c in components if c["id"] == cid)
            comp["weight"] = 1
        row_id = new_id("row")
        components.append({"component": "Row", "id": row_id, "children": ids})
        root_children.append(row_id)

    for row in layout.rows:
        content = [e for e in row.elements if e.type not in _SOLO_TYPES]
        solos = [e for e in row.elements if e.type in _SOLO_TYPES]
        # Content elements share this row; each solo element gets its own.
        if content:
            emit_row(content)
        for solo in solos:
            emit_row([solo])

    if not root_children:
        return None
    components.append({"component": "Column", "id": ROOT_ID, "children": root_children})
    return components
