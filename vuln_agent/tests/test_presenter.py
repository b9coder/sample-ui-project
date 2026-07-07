"""Hybrid presenter + LLM planner fallback tests (fake LLM, no network)."""
import json

from vuln_agent.display.presenter import HybridPresenter, ToolResult
from tests.test_composers import SUMMARY_OUTPUT


class FakeResponse:
    def __init__(self, content: str) -> None:
        self.content = content


class FakeLLM:
    """Returns queued responses; records how often it was called."""

    def __init__(self, responses: list[str]) -> None:
        self.responses = list(responses)
        self.calls = 0

    def invoke(self, messages):  # noqa: ANN001
        self.calls += 1
        return FakeResponse(self.responses.pop(0))


VALID_PLAN = json.dumps(
    {
        "rows": [
            {"items": [{"element": {"type": "markdown", "content": "planned"}}]},
            {
                "items": [
                    {
                        "element": {
                            "type": "chart",
                            "variant": "bar",
                            "x_key": "name",
                            "data": [{"name": "a", "count": 1}],
                            "series": [{"key": "count"}],
                        }
                    }
                ]
            },
        ]
    }
)


def test_deterministic_path_skips_llm():
    llm = FakeLLM([VALID_PLAN])
    presenter = HybridPresenter(llm=llm, mode="hybrid")
    payload = presenter.present(
        "how many criticals?",
        "There are 42 vulnerabilities.",
        [ToolResult("get_vulnerability_summary", {"severity": ["critical"]}, SUMMARY_OUTPUT)],
    )
    assert llm.calls == 0
    assert payload.meta["source"] == "deterministic"
    # narrative markdown leads
    assert payload.rows[0].items[0].element.type == "markdown"


def test_llm_fallback_when_no_composer_matches():
    llm = FakeLLM([VALID_PLAN])
    presenter = HybridPresenter(llm=llm, mode="hybrid")
    payload = presenter.present(
        "who owns app X?",
        "Alice owns it.",
        [ToolResult("resolve_application", {"query": "X"}, {"matches": []})],
    )
    assert llm.calls == 1
    assert payload.meta["source"] == "llm"
    assert payload.rows[0].items[0].element.content == "planned"


def test_llm_repair_retry_then_success():
    llm = FakeLLM(["not json at all", VALID_PLAN])
    presenter = HybridPresenter(llm=llm, mode="llm")
    payload = presenter.present("q", "answer", [])
    assert llm.calls == 2
    assert payload.meta["source"] == "llm"


def test_llm_total_failure_falls_back_to_markdown():
    llm = FakeLLM(["garbage", "still garbage"])
    presenter = HybridPresenter(llm=llm, mode="llm")
    payload = presenter.present("q", "the plain answer", [])
    assert payload.rows[0].items[0].element.type == "markdown"
    assert "the plain answer" in payload.rows[0].items[0].element.content


def test_deterministic_mode_never_calls_llm():
    llm = FakeLLM([VALID_PLAN])
    presenter = HybridPresenter(llm=llm, mode="deterministic")
    payload = presenter.present("q", "answer", [ToolResult("unknown_tool", {}, {})])
    assert llm.calls == 0
    assert payload.rows[0].items[0].element.type == "markdown"


def test_single_filter_panel_across_multiple_tools():
    presenter = HybridPresenter(mode="deterministic")
    records_output = {
        "query_metadata": {"records_matched": 0, "filters_applied": [], "generated_at": "2026-07-06T00:00:00"},
        "records": [],
    }
    payload = presenter.present(
        "q",
        "answer",
        [
            ToolResult("get_vulnerability_summary", {}, SUMMARY_OUTPUT),
            ToolResult("get_vulnerability_records", {}, records_output),
        ],
    )
    panels = [
        item.element
        for r in payload.rows
        for item in r.items
        if item.element.type == "filter_panel"
    ]
    assert len(panels) == 1


def test_payload_is_json_serializable():
    presenter = HybridPresenter(mode="deterministic")
    payload = presenter.present(
        "q", "a", [ToolResult("get_vulnerability_summary", {}, SUMMARY_OUTPUT)]
    )
    json.dumps(payload.model_dump())  # must not raise
