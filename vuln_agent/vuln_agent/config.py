"""Environment-driven settings for the agent process."""
from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

try:  # optional; the agent works with plain env vars too
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # pragma: no cover
    pass


@dataclass(frozen=True)
class Settings:
    openrouter_api_key: str
    openrouter_model: str
    openrouter_base_url: str
    vuln_mcp_project_dir: str
    python_bin: str
    # "hybrid" (deterministic-first, LLM fallback), "deterministic", or "llm"
    presentation_mode: str
    api_port: int


@lru_cache
def get_settings() -> Settings:
    return Settings(
        openrouter_api_key=os.getenv("OPENROUTER_API_KEY", ""),
        openrouter_model=os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini"),
        openrouter_base_url=os.getenv(
            "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"
        ),
        vuln_mcp_project_dir=os.getenv("VULN_MCP_PROJECT_DIR", "."),
        python_bin=os.getenv("PYTHON_BIN", "python3"),
        presentation_mode=os.getenv("PRESENTATION_MODE", "hybrid").lower(),
        api_port=int(os.getenv("AGENT_API_PORT", "8001")),
    )
