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
from typing import Annotated, Any, Literal, Optional, Union

from pydantic import BaseModel, Field, create_model

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

# The LLM's layout output schema is GENERATED FROM THE MANIFEST at import
# (build_layout_model below) - there is no hand-maintained list of element
# types or per-element Pydantic model in this file, so the agent's
# emittable set cannot drift from what the UI published. Add an element in
# the UI, regenerate the manifest, and the agent offers it automatically:
# a presentation-only element needs nothing else here; a new trusted data
# source needs one data_providers.py entry.
#
# The one deliberate agent-side POLICY (not a schema copy) is to SUPPRESS
# `markdown`. The UI supports it, but this a2ui surface is VISUAL ONLY -
# narration already renders as the chat text reply above the surface, so a
# markdown element would just duplicate it (and, mixed into a KPI row,
# squeeze the tiles). Suppressed types are still renderable by the
# compiler; they're simply never offered to the LLM.
SUPPRESSED_ELEMENT_TYPES = {"markdown"}

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
    """Log (don't crash) the only things that can still legitimately
    mismatch now that the output schema is manifest-derived.

    Element-type drift is gone by construction (the schema IS the
    manifest). What remains genuinely agent-owned: (1) every element the
    manifest binds to a server dataset needs a registered provider, and
    (2) a suppression that no longer matches any manifest element is
    stale and worth noting."""
    stale = SUPPRESSED_ELEMENT_TYPES - set(manifest.elements)
    if stale:
        logger.info(
            "Suppressed element types are not in the manifest (stale "
            "suppression?): %s", stale,
        )
    for etype, spec in manifest.elements.items():
        if spec.data_binding and spec.data_binding not in DATA_PROVIDERS:
            logger.warning(
                "Element %r needs data binding %r but no provider is "
                "registered (data_providers.py)", etype, spec.data_binding,
            )
    logger.info(
        "Layout schema derived from manifest %s v%s: offering %s (suppressed %s)",
        manifest.catalog_id, manifest.version,
        sorted(OFFERED_ELEMENT_TYPES), sorted(SUPPRESSED_ELEMENT_TYPES),
    )


# --- LLM output schema: GENERATED FROM THE MANIFEST ---
# Each manifest element publishes a JSON-Schema `props` block (authored by
# the UI). We turn every non-suppressed element into a Pydantic model (its
# `type` literal + one field per prop), assemble those into a discriminated
# union, and wrap it as rows -> Layout. `with_structured_output(Layout)`
# then constrains the LLM to exactly the manifest's elements and props - so
# the "layout definition" IS the manifest, with no second schema to sync.
_JSON_SCALARS: dict[str, Any] = {
    "string": str, "integer": int, "number": float, "boolean": bool,
}


def _py_type(schema: dict[str, Any]) -> Any:
    """Map one JSON-Schema property (as the manifest publishes them) to a
    Python type for a Pydantic field. Covers the shapes the manifest uses;
    anything unrecognized falls back to Any (still valid, just unconstrained)."""
    t = schema.get("type")
    if t == "string" and schema.get("enum"):
        return Literal[tuple(schema["enum"])]  # type: ignore[valid-type]
    if t in _JSON_SCALARS:
        return _JSON_SCALARS[t]
    if t == "array":
        item = schema.get("items") or {}
        return list[_py_type(item)] if item else list[Any]
    if t == "object":
        return dict[str, Any]
    return Any


def _element_model(spec) -> type[BaseModel]:
    """Build the Pydantic model for one manifest element from its `props`
    JSON Schema (plus the `type` discriminator literal)."""
    props = spec.props or {}
    properties = props.get("properties") or {}
    required = set(props.get("required") or ())
    fields: dict[str, Any] = {"type": (Literal[spec.type], ...)}  # type: ignore[valid-type]
    for name, pschema in properties.items():
        pytype = _py_type(pschema)
        desc = (pschema or {}).get("description")
        if name in required:
            fields[name] = (pytype, Field(description=desc))
        else:
            fields[name] = (Optional[pytype], Field(default=None, description=desc))
    return create_model(
        f"{spec.type.capitalize()}Element",
        __doc__=f"Manifest element {spec.type!r} (renders as {spec.component}).",
        **fields,
    )


def build_layout_model(
    manifest: CatalogManifest = MANIFEST,
    suppressed: set[str] = SUPPRESSED_ELEMENT_TYPES,
) -> tuple[type[BaseModel], list[str]]:
    """Assemble the Layout Pydantic model straight from the manifest.
    Returns (Layout model, ordered list of offered element types)."""
    offered = [t for t in manifest.elements if t not in suppressed]
    if not offered:
        raise ValueError("Manifest offers no (non-suppressed) elements to emit")
    models = [_element_model(manifest.elements[t]) for t in offered]
    if len(models) > 1:
        element_field: Any = Annotated[Union[tuple(models)], Field(discriminator="type")]
    else:
        element_field = models[0]
    row_model = create_model(
        "LayoutRow",
        elements=(list[element_field], Field(
            description="One or more elements shown side by side in this row.")),
    )
    layout_model = create_model(
        "Layout",
        __doc__="The full screen: an ordered list of rows.",
        rows=(list[row_model], Field(description="Ordered rows, top to bottom.")),
    )
    return layout_model, offered


# Built once at import from the loaded manifest. `Layout` is what agent.py
# hands to with_structured_output; OFFERED_ELEMENT_TYPES is used for the
# manifest-derived prompt guide and the startup consistency log.
Layout, OFFERED_ELEMENT_TYPES = build_layout_model()


def manifest_element_guide(
    manifest: CatalogManifest = MANIFEST,
    offered: list[str] | None = None,
) -> str:
    """A compact, MANIFEST-DERIVED description of the offered elements
    (placement, trusted-ref props, server-injected bindings, authored
    props) for the generation prompt - so the LLM's guidance and its
    output schema come from the same source, never contradicting."""
    offered = offered if offered is not None else OFFERED_ELEMENT_TYPES
    lines: list[str] = []
    for t in offered:
        spec = manifest.elements[t]
        properties = (spec.props or {}).get("properties") or {}
        required = set((spec.props or {}).get("required") or ())
        placement = ("its OWN full-width row" if spec.placement == "solo"
                     else "may share a row with other combinable elements")
        refs = (f" Trusted-reference prop(s) (preferred - bind real data): "
                f"{', '.join(spec.data_ref_props)}." if spec.data_ref_props else "")
        binding = (" The server injects its data - just add an empty element "
                   "(optional authored props below)." if spec.data_binding else "")
        prop_bits = [n + ("*" if n in required else "") for n in properties] or ["(none)"]
        lines.append(
            f"- {t}: takes {placement}.{refs}{binding} "
            f"Props: {', '.join(prop_bits)}."
        )
    return (
        "Supported elements come from the UI's catalog manifest "
        "(* = required prop):\n" + "\n".join(lines)
    )


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
