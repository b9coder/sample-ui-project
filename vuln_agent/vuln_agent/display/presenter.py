"""Hybrid presenter: deterministic-first, LLM fallback.

Flow per agent turn:
1. The agent's narrative answer always becomes the leading markdown row.
2. For every tool that ran, try a registered deterministic composer
   (`composers.py`). Predictable outputs (summary, ranking, trend,
   records) never touch the LLM.
3. If NO composer produced rows (unknown tool, composer error, or
   free-form question) and an LLM is available, ask the LLM planner to
   lay out rows; its output is schema-validated.
4. `mode` overrides: "deterministic" never calls the LLM,
   "llm" always plans with the LLM, "hybrid" (default) = steps 2-3.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from . import llm_planner
from .composers import ComposeContext, compose_tool_result
from .elements import DisplayPayload, DisplayRow, MarkdownElement, row

logger = logging.getLogger(__name__)


@dataclass
class ToolResult:
    """One tool invocation observed during the agent turn."""

    tool_name: str
    args: dict[str, Any] = field(default_factory=dict)
    output: Any = None


class HybridPresenter:
    def __init__(self, llm: Any = None, mode: str = "hybrid") -> None:
        if mode not in ("hybrid", "deterministic", "llm"):
            raise ValueError(f"Unknown presentation mode: {mode}")
        self.llm = llm
        self.mode = mode

    def present(
        self,
        user_query: str,
        answer_text: str,
        tool_results: list[ToolResult] | None = None,
    ) -> DisplayPayload:
        tool_results = tool_results or []
        rows: list[DisplayRow] = []
        source = "deterministic"

        if self.mode != "llm":
            rows = self._compose_deterministic(user_query, tool_results)

        if not rows and self.mode != "deterministic" and self.llm is not None:
            rows = llm_planner.plan_rows(
                self.llm,
                user_query,
                answer_text,
                [
                    {"tool": tr.tool_name, "args": tr.args, "output": tr.output}
                    for tr in tool_results
                ],
            )
            source = "llm"

        # The narrative answer always leads (unless the LLM plan already
        # starts with markdown, which its prompt asks for).
        if answer_text and not self._starts_with_markdown(rows):
            rows.insert(0, row(MarkdownElement(content=answer_text), id="answer"))

        if not rows:  # nothing at all -> plain markdown
            rows = [row(MarkdownElement(content=answer_text or "No results."), id="answer")]

        return DisplayPayload(
            message=answer_text,
            rows=rows,
            meta={
                "source": source,
                "mode": self.mode,
                "tools_used": [tr.tool_name for tr in tool_results],
            },
        )

    def _compose_deterministic(
        self, user_query: str, tool_results: list[ToolResult]
    ) -> list[DisplayRow]:
        rows: list[DisplayRow] = []
        seen_filter_panel = False
        for tr in tool_results:
            ctx = ComposeContext(user_query=user_query, tool_args=tr.args)
            composed = compose_tool_result(tr.tool_name, tr.output, ctx)
            if not composed:
                continue
            for r in composed:
                # Avoid stacking multiple filter panels when several tools ran.
                if any(item.element.type == "filter_panel" for item in r.items):
                    if seen_filter_panel:
                        continue
                    seen_filter_panel = True
                rows.append(r)
        return rows

    @staticmethod
    def _starts_with_markdown(rows: list[DisplayRow]) -> bool:
        return bool(rows) and rows[0].items[0].element.type == "markdown"
