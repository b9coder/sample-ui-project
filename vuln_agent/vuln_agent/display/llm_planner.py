"""LLM fallback planner: asks the model to lay out display rows as JSON.

Used when no deterministic composer matches the tools that ran (or when
PRESENTATION_MODE=llm). The plan is validated against the same Pydantic
contract the UI consumes; one repair round-trip on validation failure,
then a safe markdown-only fallback.

The `llm` argument is any LangChain chat model (only `.invoke` is used),
which keeps this module import-light and easy to test with a fake.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from .elements import DisplayRow, MarkdownElement, row

logger = logging.getLogger(__name__)


class RowsPlan(BaseModel):
    """What the LLM must return: {"rows": [...]}"""

    rows: list[DisplayRow] = Field(default_factory=list)


PLANNER_SYSTEM_PROMPT = """You are a UI layout planner. Given a user's question, \
the assistant's text answer, and raw tool results (JSON), produce a JSON object \
{"rows": [...]} describing how to visualize the answer.

Each row = {"items": [{"element": <element>, "span": 0-12}]} (span 0 = split evenly, max ~2-3 elements per row).

Element types (discriminated by "type"):
- {"type":"markdown","content": "..."}  - rich text
- {"type":"chart","variant":"bar|line|area|pie|donut","title":"...","x_key":"...",
   "data":[{...}],"series":[{"key":"...","label":"...","color":"var(--chart-1)"}],
   "stacked":false,"horizontal":false,"height":280}
  (data keys must match x_key and series keys; colors var(--chart-1..5))
- {"type":"download","title":"...","file_name":"...","url":"...","format":"csv","record_count":123}
- {"type":"filter_panel","title":"Filters","fields":[{"id":"severity","label":"Severity",
   "control":"select|multiselect|toggle|daterange|text","options":[{"value":"high"}],"value":null}]}
- {"type":"table","title":"...","columns":[{"key":"...","label":"...","format":"text|number|date|badge|boolean"}],"rows":[{...}]}
- {"type":"stats","items":[{"label":"...","value":123,"intent":"default|success|warning|danger"}]}

Rules:
- Start with a markdown row summarizing the answer (concise).
- Prefer charts for breakdowns/trends, tables for row-level data, stats for headline counts.
- Include a download element only if a tool result contains a download URL.
- Use ONLY data present in the tool results; never invent numbers.
- Respond with the JSON object ONLY - no prose, no code fences."""


def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.S)
    return json.loads(text)


def _truncate(obj: Any, max_chars: int = 12000) -> str:
    s = json.dumps(obj, default=str)
    return s if len(s) <= max_chars else s[:max_chars] + "...(truncated)"


def plan_rows(
    llm: Any,
    user_query: str,
    answer_text: str,
    tool_results: list[dict[str, Any]],
    max_retries: int = 1,
) -> list[DisplayRow]:
    """Ask the LLM for a row layout; validate; repair once; fall back to
    a plain markdown row on failure."""
    user_prompt = (
        f"User question: {user_query}\n\n"
        f"Assistant answer: {answer_text}\n\n"
        f"Tool results:\n{_truncate(tool_results)}"
    )
    messages = [
        {"role": "system", "content": PLANNER_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    for attempt in range(max_retries + 1):
        try:
            response = llm.invoke(messages)
            content = getattr(response, "content", response)
            plan = RowsPlan.model_validate(_extract_json(content))
            if plan.rows:
                return plan.rows
            raise ValueError("planner returned no rows")
        except (json.JSONDecodeError, ValidationError, ValueError) as exc:
            logger.warning("LLM plan invalid (attempt %d): %s", attempt + 1, exc)
            messages.append({"role": "assistant", "content": str(getattr(exc, "args", exc))[:500]})
            messages.append(
                {
                    "role": "user",
                    "content": f"Your previous output was invalid: {exc}. "
                    "Return ONLY the corrected JSON object.",
                }
            )
        except Exception:  # noqa: BLE001 - LLM/transport error
            logger.exception("LLM planner call failed")
            break

    fallback = answer_text or "Sorry - I couldn't format this response."
    return [row(MarkdownElement(content=fallback), id="fallback-markdown")]
