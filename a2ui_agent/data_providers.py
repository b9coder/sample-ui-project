"""Trusted-data providers, keyed by the `dataBinding` names the UI's
catalog manifest declares.

This is the agent-owned half of the contract boundary: the UI manifest
says "this element needs the `vulnerability_records` dataset"; this
registry says *how* to pull that dataset from the turn's tool output.
Presentation-only elements (a new chart type, a stat card) need NO entry
here - they're fully manifest-driven. Only a genuinely new trusted data
source requires a one-line provider addition.

Each provider takes the turn's tool results + applied filters and returns
the props to inject into the rendered component (or None to drop the
element when its backing data is absent). These props always carry the
real MCP data, never anything the LLM authored.
"""
from __future__ import annotations

from typing import Any, Callable

# Static filter panel definition + records columns live with the
# providers that emit them (the agent owns injected presentation of
# trusted data; the manifest only names the binding).
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

# Provider signature: (tool_data, applied_filters, element) -> the final
# a2ui component props to render (minus component/id), or None to drop.
# `element` is the LLM's authored layout element, so a provider can honor
# authored presentation props (a table title, a download label).
Provider = Callable[[dict[str, Any], dict[str, Any], Any], "dict[str, Any] | None"]


def _summary(tool_data: dict[str, Any]) -> dict[str, Any] | None:
    s = tool_data.get("get_vulnerability_summary")
    if not s:
        return None
    total = (s.get("summary") or {}).get("total_vulnerabilities", 0)
    return s if total > 0 else None


def _records_provider(tool_data, _filters, element) -> dict[str, Any] | None:
    records = (tool_data.get("get_vulnerability_records") or {}).get("records")
    if not records:
        return None
    # Rows injected verbatim from the tool -> always trusted.
    return {
        "title": getattr(element, "title", None) or "Matching Vulnerabilities",
        "columns": RECORD_COLUMNS,
        "rows": records,
        "trusted": True,
    }


def _export_provider(tool_data, _filters, element) -> dict[str, Any] | None:
    export = (_summary(tool_data) or {}).get("export") or {}
    url = export.get("download_url")
    if not url:
        return None
    count = export.get("record_count")
    label = getattr(element, "label", None) or (
        f"Download report ({count} findings)" if count is not None else "Download report"
    )
    return {"url": url, "label": label}


def _filter_provider(_tool_data, applied_filters, _element) -> dict[str, Any]:
    return {"fields": FILTER_FIELDS, "values": applied_filters}


DATA_PROVIDERS: dict[str, Provider] = {
    "vulnerability_records": _records_provider,
    "summary_export": _export_provider,
    "filter_schema": _filter_provider,
}
