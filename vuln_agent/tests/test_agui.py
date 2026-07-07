"""AG-UI event stream tests - pure generator, no LangGraph/network needed.

Requires `ag-ui-protocol` (see requirements.txt).
"""
import json

import pytest

pytest.importorskip("ag_ui")

from ag_ui.core import RunAgentInput, UserMessage  # noqa: E402

from vuln_agent.agui import agui_event_stream, extract_chat_input  # noqa: E402
from vuln_agent.display.elements import DisplayPayload, MarkdownElement, row  # noqa: E402
from vuln_agent.display.presenter import ToolResult  # noqa: E402


def make_input(**overrides):
    base = dict(
        thread_id="t1",
        run_id="r1",
        state={},
        messages=[
            UserMessage(id="m0", role="user", content="earlier question"),
            UserMessage(id="m1", role="user", content="how many criticals?"),
        ],
        tools=[],
        context=[],
        forwarded_props={},
    )
    base.update(overrides)
    return RunAgentInput(**base)


PAYLOAD = DisplayPayload(
    message="42 criticals.",
    rows=[row(MarkdownElement(content="42 criticals."), id="answer")],
    meta={"source": "deterministic"},
)


async def ok_run_turn(message, history, filters):
    assert message == "how many criticals?"
    assert history == [{"role": "user", "content": "earlier question"}]
    return (
        "42 criticals.",
        [ToolResult("get_vulnerability_summary", {"severity": ["critical"]}, {"n": 42})],
        PAYLOAD,
    )


async def boom_run_turn(message, history, filters):
    raise RuntimeError("kaboom")


def parse_sse(chunks: list[str]) -> list[dict]:
    events = []
    for chunk in chunks:
        for line in chunk.splitlines():
            if line.startswith("data: "):
                events.append(json.loads(line[len("data: "):]))
    return events


async def collect(gen) -> list[dict]:
    return parse_sse([chunk async for chunk in gen])


@pytest.mark.asyncio
async def test_event_sequence():
    events = await collect(agui_event_stream(make_input(), ok_run_turn))
    types = [e["type"] for e in events]
    assert types == [
        "RUN_STARTED",
        "TOOL_CALL_START",
        "TOOL_CALL_ARGS",
        "TOOL_CALL_END",
        "TOOL_CALL_RESULT",
        "TEXT_MESSAGE_START",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_END",
        "CUSTOM",
        "RUN_FINISHED",
    ]


@pytest.mark.asyncio
async def test_display_rows_custom_event_carries_payload():
    events = await collect(agui_event_stream(make_input(), ok_run_turn))
    custom = next(e for e in events if e["type"] == "CUSTOM")
    assert custom["name"] == "display_rows"
    assert custom["value"]["rows"][0]["items"][0]["element"]["type"] == "markdown"
    finished = next(e for e in events if e["type"] == "RUN_FINISHED")
    assert finished["result"] == custom["value"]


@pytest.mark.asyncio
async def test_error_emits_run_error():
    events = await collect(agui_event_stream(make_input(), boom_run_turn))
    assert [e["type"] for e in events] == ["RUN_STARTED", "RUN_ERROR"]
    assert "kaboom" in events[-1]["message"]


@pytest.mark.asyncio
async def test_filters_forwarded():
    seen = {}

    async def spy_run_turn(message, history, filters):
        seen["filters"] = filters
        return "ok", [], PAYLOAD

    await collect(
        agui_event_stream(
            make_input(forwarded_props={"filters": {"severity": ["high"]}}),
            spy_run_turn,
        )
    )
    assert seen["filters"] == {"severity": ["high"]}


def test_extract_chat_input():
    msg, history = extract_chat_input(make_input())
    assert msg == "how many criticals?"
    assert history == [{"role": "user", "content": "earlier question"}]
