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

import logging
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Field

from a2ui_schema import ROOT_ID
from catalog_manifest import CatalogManifest, load_manifest
from data_providers import DATA_PROVIDERS

logger = logging.getLogger(__name__)

# The catalog manifest is the UI-owned contract (see catalog_manifest.py):
# it names the supported elements and, per element, their placement
# (solo vs combinable), which authored props are trusted data references,
# and what server-injected data binding they need. Loaded once at import;
# compile_layout reads its rules instead of hard-coding them.
MANIFEST: CatalogManifest = load_manifest()

# Element types this agent's Pydantic Layout schema (below) can currently
# EMIT. The manifest may advertise more (a UI ahead of the agent) or
# fewer; check_manifest_consistency() surfaces the drift. Fully removing
# this hand-maintained set requires generating the Pydantic models from
# the manifest too (a documented next increment).
#
# NOTE: `markdown` is in the manifest (the UI supports it) but the agent
# deliberately does NOT emit it into the surface - narration already
# renders as the chat text reply above the surface, so a markdown
# element there would just duplicate it (and, mixed into a KPI row,
# squeeze the tiles). The a2ui surface is visual-only here.
KNOWN_ELEMENT_TYPES = {"kpi", "chart", "table", "download", "filter"}

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


def check_manifest_consistency(manifest: CatalogManifest = MANIFEST) -> None:
    """Log (don't crash) any drift between the shared manifest and this
    agent's capabilities, so mismatches are visible at startup."""
    manifest_types = set(manifest.elements)
    # A UI ahead of the agent (manifest lists more) is fine - the agent
    # just doesn't emit those yet; log at INFO. An agent ahead of the UI
    # (emits something the manifest lacks) IS a problem - the client
    # can't render it; log at WARNING.
    if manifest_types - KNOWN_ELEMENT_TYPES:
        logger.info(
            "Manifest advertises elements the agent doesn't emit "
            "(expected if the UI is ahead): %s", manifest_types - KNOWN_ELEMENT_TYPES,
        )
    if KNOWN_ELEMENT_TYPES - manifest_types:
        logger.warning(
            "Agent can emit elements the manifest doesn't list (UI won't "
            "render them): %s", KNOWN_ELEMENT_TYPES - manifest_types,
        )
    for etype, spec in manifest.elements.items():
        if spec.data_binding and spec.data_binding not in DATA_PROVIDERS:
            logger.warning(
                "Element %r needs data binding %r but no provider is "
                "registered (data_providers.py)", etype, spec.data_binding,
            )


# --- LLM output schema: rows of typed elements ---
# (No markdown element on purpose - the surface is visual-only; the
# narration is the chat text reply. See KNOWN_ELEMENT_TYPES above.)
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
    KpiElement, ChartElement, TableElement, DownloadElement, FilterElement
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
# (Placement rules come from the manifest; data injection from
# data_providers.py - nothing element-specific is hard-coded here.)
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
    layout: Layout,
    tool_data: dict[str, Any],
    applied_filters: dict[str, Any],
    manifest: CatalogManifest = MANIFEST,
) -> list[dict[str, Any]] | None:
    """Turn the LLM's row layout into a valid a2ui component list, driven
    by the shared catalog manifest.

    Per element, the manifest supplies: the a2ui component NAME to render
    as, its PLACEMENT (solo row vs combinable), which authored props are
    trusted data REFERENCES, and what server-injected DATA BINDING it
    needs. Data-bound elements are filled by data_providers.py; ref-
    bearing ones (chart/kpi) resolve their reference to trusted data;
    everything else passes its authored props straight through. Python
    still emits all ids/references, so the tree can never dangle. Returns
    None if nothing renderable remains.
    """
    components: list[dict[str, Any]] = []
    root_children: list[str] = []
    counter = 0

    def new_id(prefix: str) -> str:
        nonlocal counter
        counter += 1
        return f"{prefix}_{counter}"

    def build_element(el: Any) -> str | None:
        spec = manifest.elements.get(el.type)
        if spec is None:
            return None  # element the manifest doesn't define - skip safely

        # 1. Server-injected data binding (table/download/filter, ...).
        if spec.data_binding:
            provider = DATA_PROVIDERS.get(spec.data_binding)
            if provider is None:
                return None
            injected = provider(tool_data, applied_filters, el)
            if injected is None:
                return None
            cid = new_id(el.type)
            components.append({"component": spec.component, "id": cid, **injected})
            return cid

        # 2. Chart: prefer trusted data bound by dataRef; inline fallback.
        if el.type == "chart":
            data = xkey = series = None
            trusted = False
            if "dataRef" in spec.data_ref_props and el.dataRef:
                resolved = resolve_ref(tool_data, el.dataRef)
                if resolved is not _MISSING:
                    built = _chart_from_ref(resolved, el.xKey, el.series)
                    if built:
                        data, xkey, series = built
                        trusted = True
            if data is None and el.data:
                data, xkey, series, trusted = el.data, el.xKey or "label", el.series or ["value"], False
            if data is None:
                return None
            cid = new_id("chart")
            components.append({
                "component": spec.component, "id": cid, "chartType": el.chartType,
                "title": el.title, "xKey": xkey, "series": series,
                "data": data, "trusted": trusted,
            })
            return cid

        # 3. KPI: prefer a trusted scalar valueRef; inline fallback.
        if el.type == "kpi":
            value: str | None = None
            trusted = False
            if "valueRef" in spec.data_ref_props and el.valueRef:
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
                "component": spec.component, "id": cid, "label": el.label,
                "value": value, "trusted": trusted,
            })
            return cid

        # 4. Generic passthrough (markdown, and any future presentation-
        #    only element with no binding or reference): render its
        #    authored props directly.
        authored = el.model_dump(exclude_none=True)
        authored.pop("type", None)
        cid = new_id(el.type)
        components.append({"component": spec.component, "id": cid, **authored})
        return cid

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

    solo_types = manifest.solo_types
    for row in layout.rows:
        content = [e for e in row.elements if e.type not in solo_types]
        solos = [e for e in row.elements if e.type in solo_types]
        # Content elements share this row; each solo element gets its own.
        if content:
            emit_row(content)
        for solo in solos:
            emit_row([solo])

    if not root_children:
        return None
    components.append({"component": "Column", "id": ROOT_ID, "children": root_children})
    return components
