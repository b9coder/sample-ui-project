"""Display-element presentation layer.

- `elements`: the JSON contract (Pydantic models) shared with the UI.
- `composers`: deterministic per-tool composers (registry, extensible).
- `llm_planner`: LLM fallback that plans rows when no rule matches.
- `presenter`: hybrid orchestrator (deterministic-first, LLM fallback).
"""
from .elements import (  # noqa: F401
    ChartElement,
    DisplayPayload,
    DisplayRow,
    DownloadElement,
    FilterPanelElement,
    MarkdownElement,
    RowItem,
    StatsElement,
    TableElement,
    row,
)
from .presenter import HybridPresenter, ToolResult  # noqa: F401
