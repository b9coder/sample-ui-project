"""LangGraph ReAct agent over the vulnerability MCP server.

Launches `python -m vulnerability_mcp.server` over stdio via
langchain-mcp-adapters, exposes its tools to a ChatOpenAI model
(OpenRouter), and extracts (answer_text, tool_results) from each turn
for the presentation layer.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from langchain_core.messages import AIMessage, ToolMessage
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from .config import Settings, get_settings
from .display.presenter import ToolResult

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a vulnerability-management analyst assistant.
Use the available tools to answer questions about vulnerabilities,
risk rankings, remediation trends, and raw records.

Guidelines:
- Filter values: application_ids are short codes (e.g. 'APP000');
  application_names are human-readable (e.g. 'Application-000').
- Owner filters take ECNs - resolve names with resolve_user first.
- Prefer get_vulnerability_summary for counts/breakdowns,
  get_risk_ranking for "riskiest" questions, get_remediation_trend for
  time-based questions, get_vulnerability_records to show actual rows.
- Answer concisely in plain text; the UI renders charts/tables from the
  tool data separately, so do NOT repeat long lists of numbers."""


def build_llm(settings: Settings) -> ChatOpenAI:
    return ChatOpenAI(
        model=settings.openrouter_model,
        api_key=settings.openrouter_api_key,
        base_url=settings.openrouter_base_url,
        temperature=0,
    )


def build_mcp_client(settings: Settings) -> MultiServerMCPClient:
    return MultiServerMCPClient(
        {
            "vulnerability": {
                "transport": "stdio",
                "command": settings.python_bin,
                "args": ["-m", "vulnerability_mcp.server"],
                "cwd": settings.vuln_mcp_project_dir,
            }
        }
    )


async def build_agent(settings: Settings | None = None):
    """Returns (agent, llm). The agent is a LangGraph runnable."""
    settings = settings or get_settings()
    llm = build_llm(settings)
    client = build_mcp_client(settings)
    tools = await client.get_tools()
    logger.info("Loaded %d MCP tools: %s", len(tools), [t.name for t in tools])
    agent = create_react_agent(llm, tools, prompt=SYSTEM_PROMPT)
    return agent, llm


def _parse_tool_content(content: Any) -> Any:
    """ToolMessage content may be a JSON string or a list of content blocks."""
    if isinstance(content, list):
        content = "".join(
            block.get("text", "") if isinstance(block, dict) else str(block)
            for block in content
        )
    if isinstance(content, str):
        try:
            return json.loads(content)
        except (json.JSONDecodeError, ValueError):
            return content
    return content


def extract_turn(result: dict[str, Any]) -> tuple[str, list[ToolResult]]:
    """Walk the LangGraph message history for the final answer text and
    every (tool name, args, parsed output) triple."""
    messages = result.get("messages", [])
    args_by_call_id: dict[str, dict[str, Any]] = {}
    names_by_call_id: dict[str, str] = {}
    tool_results: list[ToolResult] = []
    answer_text = ""

    for msg in messages:
        if isinstance(msg, AIMessage):
            for call in msg.tool_calls or []:
                args_by_call_id[call.get("id", "")] = call.get("args", {}) or {}
                names_by_call_id[call.get("id", "")] = call.get("name", "")
            if msg.content and not msg.tool_calls:
                answer_text = (
                    msg.content
                    if isinstance(msg.content, str)
                    else "".join(
                        b.get("text", "") if isinstance(b, dict) else str(b)
                        for b in msg.content
                    )
                )
        elif isinstance(msg, ToolMessage):
            call_id = msg.tool_call_id or ""
            tool_results.append(
                ToolResult(
                    tool_name=msg.name or names_by_call_id.get(call_id, ""),
                    args=args_by_call_id.get(call_id, {}),
                    output=_parse_tool_content(msg.content),
                )
            )

    return answer_text, tool_results


async def run_chat(
    agent: Any, message: str, history: list[dict[str, str]] | None = None
) -> tuple[str, list[ToolResult]]:
    """Run one chat turn. `history` items: {"role": "user"|"assistant", "content": str}."""
    messages: list[tuple[str, str]] = [
        (h["role"], h["content"]) for h in (history or []) if h.get("content")
    ]
    messages.append(("user", message))
    result = await agent.ainvoke({"messages": messages})
    return extract_turn(result)
