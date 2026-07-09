"""Related follow-up questions shown under the answer, so the user can
click to explore further.

This is a TUNABLE module - the deterministic rules below are the single
place to edit what gets suggested. Each rule pairs a context predicate
(does this turn have a summary? records? an admin user?) with the
questions to offer when it holds. `build_suggestions` collects the
matching ones, drops anything too close to what was just asked,
de-duplicates, and caps the list.

Mode is set by SUGGESTIONS_MODE:
  - "deterministic" (default) - the rules below only. No LLM, instant.
  - "llm"                     - an LLM proposes questions from the answer
                                and available data (schema-constrained,
                                falls back to the rules on failure).
  - "off"                     - no suggestions.
"""
from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from typing import Any, Callable

from langchain_core.language_models.chat_models import BaseChatModel
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

SUGGESTIONS_MODE = os.environ.get("SUGGESTIONS_MODE", "deterministic").strip().lower()
MAX_SUGGESTIONS = int(os.environ.get("MAX_SUGGESTIONS", "3"))
# The landing shows MORE starting points than a normal turn's follow-ups.
MAX_LANDING_SUGGESTIONS = int(os.environ.get("MAX_LANDING_SUGGESTIONS", "6"))


@dataclass
class SuggestionContext:
    """What a rule can look at. Extend this (and populate it in
    `build_context`) to key suggestions off more signals."""

    user_query: str
    is_session_start: bool
    has_summary: bool
    has_records: bool
    has_ranking: bool
    has_trend: bool
    is_admin: bool
    has_delegations: bool


# --- TUNE HERE: (predicate, questions offered when it holds) ---------------
# Order matters - earlier rules' questions are preferred when capping.
SUGGESTION_RULES: list[tuple[Callable[[SuggestionContext], bool], list[str]]] = [
    # Landing "starting points" - richer, scope-aware set shown when the
    # user first arrives (see MAX_LANDING_SUGGESTIONS).
    (
        lambda c: c.is_session_start,
        [
            "Show my most critical applications",
            "Applications with overdue vulnerabilities",
            "Summarize risk by business unit",
            "Find internet-facing assets with High or Critical findings",
            "Which teams need the most remediation?",
            "Export my current vulnerability inventory",
        ],
    ),
    (
        lambda c: c.is_admin and c.is_session_start,
        ["Show the org-wide severity breakdown"],
    ),
    (
        lambda c: c.has_delegations,
        ["Show vulnerabilities delegated to me"],
    ),
    (
        lambda c: c.has_records,
        [
            "Show only the internet-facing findings",
            "Show only the escalated ones",
        ],
    ),
    (
        lambda c: c.has_summary,
        [
            "Break this down by operating system",
            "Which applications have the most findings?",
            "How many are internet-facing?",
            "Show the remediation trend over time",
        ],
    ),
    (
        lambda c: c.has_ranking,
        ["Show the findings for the top application"],
    ),
    (
        lambda c: c.has_trend,
        ["What's driving the past-due trend?"],
    ),
]

# Shown when nothing more specific matched.
FALLBACK_SUGGESTIONS = [
    "Show me my critical vulnerabilities",
    "What's past due?",
    "Which applications are most at risk?",
]


def build_context(tool_data: dict[str, Any], user_query: str) -> SuggestionContext:
    summary = tool_data.get("get_vulnerability_summary")
    summary_total = (summary.get("summary") or {}).get("total_vulnerabilities", 0) if summary else 0
    access = tool_data.get("get_user_access") or {}
    return SuggestionContext(
        user_query=user_query,
        is_session_start=user_query.strip().lower().startswith("session start"),
        has_summary=summary is not None and summary_total > 0,
        has_records=bool((tool_data.get("get_vulnerability_records") or {}).get("records")),
        has_ranking=bool((tool_data.get("get_risk_ranking") or {}).get("ranking")),
        has_trend=bool((tool_data.get("get_remediation_trend") or {}).get("trend")),
        is_admin=bool(access.get("is_admin")),
        has_delegations=bool(access.get("delegations")),
    )


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", s.lower()).strip()


def _dedupe_and_cap(questions: list[str], user_query: str, cap: int) -> list[str]:
    asked = _norm(user_query)
    seen: set[str] = set()
    out: list[str] = []
    for q in questions:
        key = _norm(q)
        if not key or key in seen or key == asked:
            continue
        seen.add(key)
        out.append(q)
        if len(out) >= cap:
            break
    return out


def _deterministic(context: SuggestionContext) -> list[str]:
    collected: list[str] = []
    for predicate, questions in SUGGESTION_RULES:
        try:
            if predicate(context):
                collected.extend(questions)
        except Exception:  # a bad custom rule must never break the turn
            logger.exception("suggestion rule raised; skipping it")
    collected.extend(FALLBACK_SUGGESTIONS)
    cap = MAX_LANDING_SUGGESTIONS if context.is_session_start else MAX_SUGGESTIONS
    return _dedupe_and_cap(collected, context.user_query, cap)


class _Suggestions(BaseModel):
    questions: list[str] = Field(
        description=f"{MAX_SUGGESTIONS} short, distinct follow-up questions the user might click."
    )


async def _llm(
    tool_data: dict[str, Any], user_query: str, assistant_text: str, llm: BaseChatModel
) -> list[str] | None:
    try:
        structured = llm.with_structured_output(_Suggestions, method="function_calling")
        result = await structured.ainvoke(
            f"The user asked: {user_query}\n\n"
            f"The assistant answered: {assistant_text}\n\n"
            f"Available data namespaces: {list(tool_data)}\n\n"
            f"Propose {MAX_SUGGESTIONS} SHORT, natural follow-up questions this user is "
            "likely to want next about their vulnerabilities (each a single clickable "
            "sentence, phrased as the user speaking, distinct from what was already asked). "
            "Only suggest things answerable from vulnerability data."
        )
    except Exception:
        logger.exception("LLM suggestion generation failed; falling back to rules")
        return None
    is_landing = user_query.strip().lower().startswith("session start")
    cap = MAX_LANDING_SUGGESTIONS if is_landing else MAX_SUGGESTIONS
    return _dedupe_and_cap(result.questions, user_query, cap)


async def build_suggestions(
    tool_data: dict[str, Any],
    user_query: str,
    assistant_text: str,
    llm: BaseChatModel | None = None,
) -> list[str]:
    """The 2-3 related questions to show under this turn's answer."""
    if SUGGESTIONS_MODE == "off":
        return []
    context = build_context(tool_data, user_query)
    if SUGGESTIONS_MODE == "llm" and llm is not None:
        llm_out = await _llm(tool_data, user_query, assistant_text, llm)
        if llm_out:
            return llm_out
    return _deterministic(context)
