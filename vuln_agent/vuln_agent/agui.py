"""AG-UI protocol bridge (https://docs.ag-ui.com).

Exposes the agent as an AG-UI compatible SSE stream. Event sequence per run:

    RUN_STARTED
    TOOL_CALL_START / TOOL_CALL_ARGS / TOOL_CALL_END / TOOL_CALL_RESULT   (per tool)
    TEXT_MESSAGE_START / TEXT_MESSAGE_CONTENT / TEXT_MESSAGE_END          (answer)
    CUSTOM name="display_rows" value=DisplayPayload                       (the UI rows)
    RUN_FINISHED result=DisplayPayload
    (RUN_ERROR on failure)

The React app consumes this with @ag-ui/client's HttpAgent; the
`display_rows` custom event carries the same DisplayPayload as REST /chat,
so both transports share one contract.

`agui_event_stream` is transport-pure (takes a `run_turn` callable) so it
can be tested without LangGraph, OpenRouter, or the MCP server.
"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Awaitable, Callable

from ag_ui.core import (
    CustomEvent,
    EventType,
    RunAgentInput,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
    ToolCallStartEvent,
)
from ag_ui.encoder import EventEncoder

from .display.elements import DisplayPayload
from .display.presenter import ToolResult

logger = logging.getLogger(__name__)

DISPLAY_ROWS_EVENT = "display_rows"

# run_turn(message, history, filters) -> (answer_text, tool_results, payload)
RunTurn = Callable[
    [str, list[dict[str, str]], dict[str, Any] | None],
    Awaitable[tuple[str, list[ToolResult], DisplayPayload]],
]


def extract_chat_input(input_data: RunAgentInput) -> tuple[str, list[dict[str, str]]]:
    """Split AG-UI messages into (latest user message, prior history)."""
    history: list[dict[str, str]] = []
    user_message = ""
    for msg in input_data.messages or []:
        role = getattr(msg, "role", None)
        content = getattr(msg, "content", None) or ""
        if role in ("user", "assistant") and content:
            history.append({"role": role, "content": content})
    if history and history[-1]["role"] == "user":
        user_message = history.pop()["content"]
    return user_message, history


async def agui_event_stream(
    input_data: RunAgentInput,
    run_turn: RunTurn,
    accept: str | None = None,
):
    """Yield encoded AG-UI events for one agent run."""
    encoder = EventEncoder(accept=accept)
    thread_id, run_id = input_data.thread_id, input_data.run_id

    yield encoder.encode(
        RunStartedEvent(type=EventType.RUN_STARTED, thread_id=thread_id, run_id=run_id)
    )

    try:
        user_message, history = extract_chat_input(input_data)
        forwarded = input_data.forwarded_props or {}
        filters = forwarded.get("filters") if isinstance(forwarded, dict) else None

        answer_text, tool_results, payload = await run_turn(
            user_message, history, filters
        )

        message_id = str(uuid.uuid4())

        # Replay tool calls for observability in AG-UI clients.
        for tr in tool_results:
            tool_call_id = str(uuid.uuid4())
            yield encoder.encode(
                ToolCallStartEvent(
                    type=EventType.TOOL_CALL_START,
                    tool_call_id=tool_call_id,
                    tool_call_name=tr.tool_name,
                    parent_message_id=message_id,
                )
            )
            yield encoder.encode(
                ToolCallArgsEvent(
                    type=EventType.TOOL_CALL_ARGS,
                    tool_call_id=tool_call_id,
                    delta=json.dumps(tr.args, default=str),
                )
            )
            yield encoder.encode(
                ToolCallEndEvent(type=EventType.TOOL_CALL_END, tool_call_id=tool_call_id)
            )
            yield encoder.encode(
                ToolCallResultEvent(
                    type=EventType.TOOL_CALL_RESULT,
                    message_id=str(uuid.uuid4()),
                    tool_call_id=tool_call_id,
                    content=json.dumps(tr.output, default=str)[:20000],
                    role="tool",
                )
            )

        # Assistant answer as a streamed text message.
        yield encoder.encode(
            TextMessageStartEvent(
                type=EventType.TEXT_MESSAGE_START, message_id=message_id, role="assistant"
            )
        )
        if answer_text:  # delta must be non-empty
            yield encoder.encode(
                TextMessageContentEvent(
                    type=EventType.TEXT_MESSAGE_CONTENT,
                    message_id=message_id,
                    delta=answer_text,
                )
            )
        yield encoder.encode(
            TextMessageEndEvent(type=EventType.TEXT_MESSAGE_END, message_id=message_id)
        )

        # The display rows the UI renders.
        payload_dict = payload.model_dump(mode="json")
        yield encoder.encode(
            CustomEvent(
                type=EventType.CUSTOM, name=DISPLAY_ROWS_EVENT, value=payload_dict
            )
        )

        yield encoder.encode(
            RunFinishedEvent(
                type=EventType.RUN_FINISHED,
                thread_id=thread_id,
                run_id=run_id,
                result=payload_dict,
            )
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("AG-UI run failed")
        yield encoder.encode(
            RunErrorEvent(type=EventType.RUN_ERROR, message=str(exc))
        )
