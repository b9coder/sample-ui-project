"""Per-request caller identity for access control.

The trust model: an Okta-validating gateway/reverse proxy sits in front
of this service and forwards a trusted identity header
(EMPLOYEE_ID_HEADER) on every request, after it has already verified
the user's Okta session. This service does NOT validate Okta itself -
it trusts that header because the network path from that gateway is
itself secured (internal network / mTLS / not directly
internet-reachable bypassing the gateway). If that assumption doesn't
hold in your deployment, this header must not be trusted as-is.

The identity is threaded through to MCP tool calls via a contextvar
(server.py's middleware sets it; agent.py's tool wrapper reads it) -
deliberately NOT as an LLM-supplied tool argument. A security-relevant
identity must never depend on the model choosing to pass it correctly,
since it could omit it, hallucinate a different one, or be prompt-
injected into dropping it. Trusted Python code sets this once per
request and injects it into every tool call unconditionally.
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
