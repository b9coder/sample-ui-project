"""Per-request caller identity for access control.

An Okta-validating gateway forwards a trusted `X-Employee-Id` header
(after verifying the user's session); this service trusts it because
the network path from that gateway is secured. The identity is threaded
to MCP tool calls via a contextvar (server.py sets it, agent.py's tool
wrapper injects it) - deliberately NOT as an LLM-supplied argument, so
a security-relevant identity never depends on the model passing it
correctly. Mirrors one_search_agent/identity.py.
"""
from __future__ import annotations

import contextvars

EMPLOYEE_ID_HEADER = "X-Employee-Id"

_current_employee_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "current_employee_id", default=None
)


def set_current_employee_id(value: str | None) -> None:
    _current_employee_id.set(value)


def get_current_employee_id() -> str | None:
    return _current_employee_id.get()
