"""Contract tests for display elements."""
import pytest
from pydantic import ValidationError

from vuln_agent.display.elements import (
    ChartElement,
    ChartSeries,
    DisplayPayload,
    DisplayRow,
    MarkdownElement,
    RowItem,
    row,
)


def test_discriminated_union_roundtrip():
    payload = DisplayPayload(
        message="hi",
        rows=[
            row(MarkdownElement(content="**bold**")),
            row(
                ChartElement(
                    variant="donut",
                    x_key="name",
                    data=[{"name": "critical", "count": 3}],
                    series=[ChartSeries(key="count")],
                )
            ),
        ],
    )
    dumped = payload.model_dump()
    restored = DisplayPayload.model_validate(dumped)
    assert restored.rows[0].items[0].element.type == "markdown"
    assert restored.rows[1].items[0].element.type == "chart"
    assert restored.rows[1].items[0].element.variant == "donut"


def test_unknown_element_type_rejected():
    with pytest.raises(ValidationError):
        DisplayRow.model_validate(
            {"items": [{"element": {"type": "hologram", "content": "x"}}]}
        )


def test_span_bounds():
    with pytest.raises(ValidationError):
        RowItem(element=MarkdownElement(content="x"), span=13)


def test_row_requires_items():
    with pytest.raises(ValidationError):
        DisplayRow(items=[])


def test_invalid_chart_variant_rejected():
    with pytest.raises(ValidationError):
        ChartElement(variant="scatter", x_key="x")
