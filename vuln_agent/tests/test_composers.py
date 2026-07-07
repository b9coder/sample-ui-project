"""Deterministic composer tests, with fixtures mirroring the MCP
response models (vulnerability_mcp/models/response_models.py)."""
from vuln_agent.display.composers import (
    ComposeContext,
    compose_tool_result,
    register_composer,
)
from vuln_agent.display.elements import DisplayRow, MarkdownElement, row

CTX = ComposeContext(user_query="q", tool_args={"severity": ["critical"]})

SUMMARY_OUTPUT = {
    "query_metadata": {"records_matched": 42, "filters_applied": ["severity"], "generated_at": "2026-07-06T00:00:00"},
    "summary": {
        "total_vulnerabilities": 42, "total_past_due": 7, "total_escalated": 3,
        "total_internet_facing": 5, "total_linux": 30, "total_windows": 10,
        "total_unix": 2, "total_other_os": 0, "total_kernel_related": 12,
        "total_non_kernel_related": 30, "total_exploitable": 9,
    },
    "breakdowns": {
        "severity_breakdown": {"critical": 10, "high": 20, "medium": 8, "low": 4},
        "os_breakdown": {"Linux": 30, "Windows": 10, "Unix": 2},
        "application_breakdown": {"Application-000": 25, "Application-001": 17},
    },
    "export": {"file_name": "vulnerabilities_x.csv", "download_url": "http://localhost:8000/downloads/vulnerabilities_x.csv", "record_count": 42},
}


def _element_types(rows: list[DisplayRow]) -> list[str]:
    return [item.element.type for r in rows for item in r.items]


def test_summary_composer_produces_expected_elements():
    rows = compose_tool_result("get_vulnerability_summary", SUMMARY_OUTPUT, CTX)
    types = _element_types(rows)
    assert "stats" in types
    assert types.count("chart") >= 2
    assert "download" in types
    assert "filter_panel" in types


def test_summary_filter_panel_reflects_applied_filters():
    rows = compose_tool_result("get_vulnerability_summary", SUMMARY_OUTPUT, CTX)
    panel = next(
        item.element for r in rows for item in r.items if item.element.type == "filter_panel"
    )
    severity_field = next(f for f in panel.fields if f.id == "severity")
    assert severity_field.value == ["critical"]


def test_risk_ranking_composer():
    output = {
        "query_metadata": {"records_matched": 3, "filters_applied": [], "generated_at": "2026-07-06T00:00:00"},
        "dimension": "business_unit",
        "ranking": [
            {"name": "Payments", "total_findings": 40, "risk_score": 95},
            {"name": "Retail", "total_findings": 22, "risk_score": 61},
        ],
    }
    rows = compose_tool_result("get_risk_ranking", output, CTX)
    types = _element_types(rows)
    assert types == ["chart", "table"]
    chart = rows[0].items[0].element
    assert chart.horizontal is True
    assert chart.data[0]["risk_score"] == 95


def test_trend_composer():
    output = {
        "query_metadata": {"records_matched": 2, "filters_applied": [], "generated_at": "2026-07-06T00:00:00"},
        "trend": [
            {"month": "2026-05", "discovered": 10, "remediated": 6, "past_due": 2, "escalated": 1},
            {"month": "2026-06", "discovered": 8, "remediated": 9, "past_due": 1, "escalated": 0},
        ],
    }
    rows = compose_tool_result("get_remediation_trend", output, CTX)
    chart = rows[0].items[0].element
    assert chart.variant == "line"
    assert {s.key for s in chart.series} == {"discovered", "remediated", "past_due", "escalated"}


def test_records_composer():
    output = {
        "query_metadata": {"records_matched": 1, "filters_applied": [], "generated_at": "2026-07-06T00:00:00"},
        "records": [
            {"vulnerability_id": "V-1", "hostname": "h1", "application_name": "Application-000",
             "severity": "critical", "cve_id": "CVE-2026-0001", "past_due_flag": True,
             "escalated_flag": False, "operating_system": "Linux",
             "application_owner": "E123", "due_date": "2026-08-01", "internet_facing": True},
        ],
    }
    rows = compose_tool_result("get_vulnerability_records", output, CTX)
    types = _element_types(rows)
    assert "table" in types and "filter_panel" in types


def test_unregistered_tool_returns_none():
    assert compose_tool_result("mystery_tool", {"a": 1}, CTX) is None


def test_non_dict_output_returns_none():
    assert compose_tool_result("get_vulnerability_summary", "oops", CTX) is None


def test_registry_is_extensible():
    @register_composer("my_new_tool")
    def compose_new(output, ctx):  # noqa: ANN001
        return [row(MarkdownElement(content=str(output["x"])))]

    rows = compose_tool_result("my_new_tool", {"x": 1}, CTX)
    assert rows[0].items[0].element.content == "1"


def test_failing_composer_falls_back_to_none():
    @register_composer("broken_tool")
    def compose_broken(output, ctx):  # noqa: ANN001
        raise RuntimeError("boom")

    assert compose_tool_result("broken_tool", {}, CTX) is None
