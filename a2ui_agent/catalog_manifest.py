"""Loads the shared catalog manifest that the UI project generates
(a2ui_ui/scripts/gen-catalog.ts -> a2ui_ui/catalog.manifest.json).

This is the contract between the two independently-evolving projects:
the UI owns the supported visualizations/layouts and publishes them as
JSON; the agent reads that JSON to drive its compiler rules (which
elements exist, their placement, which props are trusted data
references, and what server-injected data each needs). Neither side
hand-copies the other's schema.

Transport for a first cut: the agent reads the file from the sibling
`a2ui_ui/` directory (override with A2UI_CATALOG_MANIFEST). A future
increment can instead receive it over AG-UI via A2UI client
capabilities at session start - the parsing here stays the same.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_DEFAULT_PATH = (
    Path(__file__).resolve().parent.parent / "a2ui_ui" / "catalog.manifest.json"
)


@dataclass(frozen=True)
class ElementSpec:
    type: str
    component: str
    placement: str  # "solo" | "combinable"
    data_ref_props: tuple[str, ...]
    data_binding: str | None
    props: dict[str, Any]


@dataclass(frozen=True)
class CatalogManifest:
    catalog_id: str
    version: str
    elements: dict[str, ElementSpec]  # keyed by element type

    @property
    def solo_types(self) -> set[str]:
        return {t for t, e in self.elements.items() if e.placement == "solo"}


def load_manifest(path: str | os.PathLike[str] | None = None) -> CatalogManifest:
    """Load and parse the catalog manifest. Path resolution order:
    explicit arg, A2UI_CATALOG_MANIFEST env, then the sibling a2ui_ui."""
    resolved = Path(path or os.environ.get("A2UI_CATALOG_MANIFEST") or _DEFAULT_PATH)
    raw = json.loads(resolved.read_text())
    elements = {
        e["type"]: ElementSpec(
            type=e["type"],
            component=e["component"],
            placement=e["placement"],
            data_ref_props=tuple(e.get("dataRefProps") or ()),
            data_binding=e.get("dataBinding"),
            props=e.get("props") or {},
        )
        for e in raw["elements"]
    }
    manifest = CatalogManifest(
        catalog_id=raw["catalogId"], version=raw["version"], elements=elements
    )
    logger.info(
        "Loaded catalog manifest %s v%s from %s (%d elements)",
        manifest.catalog_id, manifest.version, resolved, len(elements),
    )
    return manifest
