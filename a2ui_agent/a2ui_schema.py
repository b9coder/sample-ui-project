"""a2ui.org v0.9 wire constants + message wrapping.

The high-level row layout the LLM emits (and the deterministic compiler
that turns it into a2ui components) lives in layout.py. This module just
holds the surface/catalog identifiers and wraps a compiled component
list into the a2ui.org v0.9 message sequence the frontend's
MessageProcessor consumes.

`CATALOG_ID` must match a2ui_ui/src/a2ui/catalog.tsx's CATALOG_ID, and
`ROOT_ID` matches the fixed id the frontend's A2uiSurface renders.
"""
from __future__ import annotations

from typing import Any

CATALOG_ID = "a2ui-vuln-catalog-v1"
SURFACE_ID = "main"
ROOT_ID = "root"


def wrap_messages(components: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Wrap a compiled component list into the a2ui.org v0.9 message
    sequence (createSurface + updateComponents)."""
    return [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": SURFACE_ID,
                "catalogId": CATALOG_ID,
                "sendDataModel": False,
            },
        },
        {
            "version": "v0.9",
            "updateComponents": {"surfaceId": SURFACE_ID, "components": components},
        },
    ]
