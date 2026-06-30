import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Chart } from "../dashboard/Chart";
import { Table } from "../dashboard/Table";
import { FilterPanel } from "../dashboard/FilterPanel";
import { KPICards } from "../dashboard/KPICards";
import { DownloadCard } from "../dashboard/DownloadCard";
import type { FilterPanelSpec, KPIItem, TableSpec } from "../dashboard/types";
import type { UIComponent, UIData, UISpec } from "./types";
import { resolveDataRef, toChartRows } from "./resolveDataRef";

function ChartComponent({ component, data }: { component: UIComponent; data: UIData }) {
  const resolved = resolveDataRef(data, component.dataRef);
  const { rows, xKey } = toChartRows(resolved, component.chart?.xKey);
  const series = component.chart?.series ?? (rows.length > 0 && "value" in rows[0] ? ["value"] : []);
  if (!component.chart || rows.length === 0 || series.length === 0) {
    return (
      <div className="osa-chart-wrap">
        {component.title && <div className="osa-chart-title">{component.title}</div>}
        <div className="osa-chart-empty">No data</div>
      </div>
    );
  }
  return (
    <Chart
      spec={{
        chartType: component.chart.chartType,
        title: component.title ?? "",
        xKey,
        series,
        data: rows,
      }}
    />
  );
}

function TableComponent({ component, data }: { component: UIComponent; data: UIData }) {
  const resolved = resolveDataRef(data, component.dataRef);
  const rows = Array.isArray(resolved) ? (resolved as Record<string, unknown>[]) : [];
  const spec: TableSpec = { columns: component.columns ?? [], rows };
  return <Table spec={spec} />;
}

function MarkdownComponent({ component }: { component: UIComponent }) {
  return (
    <div className="osa-declarative-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{component.markdown ?? ""}</ReactMarkdown>
    </div>
  );
}

function KpiComponent({ component, data }: { component: UIComponent; data: UIData }) {
  const resolved = resolveDataRef(data, component.dataRef);
  const items = Array.isArray(resolved) ? (resolved as KPIItem[]) : [];
  if (items.length === 0) return null;
  return <KPICards items={items} />;
}

// The resolved dataRef is the MCP tool's raw export object verbatim
// (file_name/download_url/record_count, snake_case) - DownloadCard
// just expects differently-named props for the same unmodified
// values, so this is a presentation-layer prop mapping, not a data
// transformation (no value is altered).
function DownloadComponent({ component, data }: { component: UIComponent; data: UIData }) {
  const resolved = resolveDataRef(data, component.dataRef) as
    | { file_name?: string; download_url?: string | null; record_count?: number }
    | undefined;
  if (!resolved?.download_url) return null;
  return (
    <DownloadCard
      spec={{
        title: component.title,
        fileName: resolved.file_name ?? "vulnerabilities.csv",
        downloadUrl: resolved.download_url,
        recordCount: resolved.record_count,
      }}
    />
  );
}

function InputFormComponent({
  component,
  data,
  onApplyFilters,
}: {
  component: UIComponent;
  data: UIData;
  onApplyFilters: (values: Record<string, unknown>) => void;
}) {
  // Today the only predefined form is "vulnerability_filters" - its
  // schema (fields) plus this turn's applied values come from the
  // dataRef'd "_filters" entry (see agent.py's _build_ui_data),
  // exactly like the legacy dashboard's FilterPanel.
  if (component.formId !== "vulnerability_filters") return null;
  const resolved = resolveDataRef(data, component.dataRef) as FilterPanelSpec | undefined;
  if (!resolved) return null;
  return <FilterPanel spec={resolved} onApply={onApplyFilters} />;
}

function RenderComponent({
  component,
  data,
  onApplyFilters,
}: {
  component: UIComponent;
  data: UIData;
  onApplyFilters: (values: Record<string, unknown>) => void;
}) {
  switch (component.type) {
    case "chart":
      return <ChartComponent component={component} data={data} />;
    case "table":
      return <TableComponent component={component} data={data} />;
    case "markdown":
      return <MarkdownComponent component={component} />;
    case "input_form":
      return <InputFormComponent component={component} data={data} onApplyFilters={onApplyFilters} />;
    case "kpi":
      return <KpiComponent component={component} data={data} />;
    case "download":
      return <DownloadComponent component={component} data={data} />;
    default:
      return null;
  }
}

export function DeclarativeDashboard({
  spec,
  data,
  onApplyFilters,
}: {
  spec: UISpec;
  data: UIData;
  onApplyFilters: (values: Record<string, unknown>) => void;
}) {
  const byId = new Map(spec.components.map((c) => [c.id, c]));

  return (
    <div className="dashboard-wrap osa-declarative">
      {spec.layout.rows.map((row, i) => (
        <div key={i} className="osa-declarative-row">
          {row.columns.map((cell) => {
            const component = byId.get(cell.componentId);
            if (!component) return null;
            return (
              <div key={cell.componentId} className="osa-declarative-cell" style={{ flex: cell.width ?? 1 }}>
                <RenderComponent component={component} data={data} onApplyFilters={onApplyFilters} />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
