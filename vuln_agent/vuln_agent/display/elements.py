"""The display-element JSON contract.

Every agent response is a `DisplayPayload`: a plain-text `message` plus a
list of `DisplayRow`s. Each row holds one or more elements rendered side
by side on a 12-column grid (span=0 means "split evenly"). The React UI
renders each element type with a dedicated component; adding a new
element type = add a model here, add a component in the UI registry.

Supported element types:
    markdown      - rich text (GitHub-flavored markdown)
    chart         - bar | line | area | pie | donut (shadcn/Recharts)
    download      - a "download report" row (file name, url, count)
    filter_panel  - applied-filter chips + editable filter controls
    table         - paginated data table
    stats         - row of stat/metric cards
"""
from __future__ import annotations

from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Field

# Default palette tokens; the UI maps these to shadcn chart CSS variables.
CHART_COLORS = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
]


class MarkdownElement(BaseModel):
    type: Literal["markdown"] = "markdown"
    content: str


class ChartSeries(BaseModel):
    """One plotted series. For pie/donut charts use a single series whose
    `key` is the numeric value field; `x_key` names each slice."""

    key: str
    label: str | None = None
    color: str | None = None  # css color or "var(--chart-n)" token


class ChartElement(BaseModel):
    type: Literal["chart"] = "chart"
    variant: Literal["bar", "line", "area", "pie", "donut"]
    title: str | None = None
    description: str | None = None
    data: list[dict[str, Any]] = Field(default_factory=list)
    x_key: str
    series: list[ChartSeries] = Field(default_factory=list)
    stacked: bool = False
    horizontal: bool = False  # bar charts only
    height: int = Field(default=280, ge=120, le=800)


class DownloadElement(BaseModel):
    type: Literal["download"] = "download"
    title: str = "Download report"
    file_name: str
    url: str
    format: str = "csv"
    record_count: int | None = None
    description: str | None = None


class FilterOption(BaseModel):
    value: str
    label: str | None = None


class FilterField(BaseModel):
    id: str
    label: str
    control: Literal["select", "multiselect", "toggle", "daterange", "text"]
    options: list[FilterOption] = Field(default_factory=list)
    value: Any = None  # currently applied value, if any


class FilterPanelElement(BaseModel):
    type: Literal["filter_panel"] = "filter_panel"
    title: str | None = "Filters"
    fields: list[FilterField] = Field(default_factory=list)
    submit_label: str = "Apply filters"


class TableColumn(BaseModel):
    key: str
    label: str
    format: Literal["text", "number", "date", "badge", "boolean"] = "text"


class TableElement(BaseModel):
    type: Literal["table"] = "table"
    title: str | None = None
    columns: list[TableColumn]
    rows: list[dict[str, Any]] = Field(default_factory=list)
    page_size: int = Field(default=10, ge=1, le=100)


class StatItem(BaseModel):
    label: str
    value: int | float | str
    intent: Literal["default", "success", "warning", "danger"] = "default"
    hint: str | None = None


class StatsElement(BaseModel):
    type: Literal["stats"] = "stats"
    items: list[StatItem]


DisplayElement = Annotated[
    Union[
        MarkdownElement,
        ChartElement,
        DownloadElement,
        FilterPanelElement,
        TableElement,
        StatsElement,
    ],
    Field(discriminator="type"),
]


class RowItem(BaseModel):
    element: DisplayElement
    span: int = Field(default=0, ge=0, le=12)  # 0 = auto (split row evenly)


class DisplayRow(BaseModel):
    id: str | None = None
    items: list[RowItem] = Field(min_length=1)


class DisplayPayload(BaseModel):
    """The full agent response the UI consumes."""

    message: str = ""
    rows: list[DisplayRow] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)


def row(*elements: Any, spans: list[int] | None = None, id: str | None = None) -> DisplayRow:
    """Convenience builder: `row(chart_a, chart_b, spans=[8, 4])`."""
    spans = spans or [0] * len(elements)
    return DisplayRow(
        id=id,
        items=[RowItem(element=el, span=sp) for el, sp in zip(elements, spans)],
    )


def rows_json_schema() -> dict[str, Any]:
    """JSON schema for a list of rows - fed to the LLM planner and served
    at /schema so UI/agent stay in sync."""
    return DisplayPayload.model_json_schema()
