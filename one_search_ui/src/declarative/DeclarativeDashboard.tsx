import { cn } from "@/lib/utils";
import type { UIComponent, UIData, UISpec } from "./types";
import { ChartElement } from "./elements/ChartElement";
import { MarkdownElement } from "./elements/MarkdownElement";
import { KpiElement } from "./elements/KpiElement";
import { DownloadElement } from "./elements/DownloadElement";
import { TableElement } from "./elements/TableElement";
import { FilterFormElement } from "./elements/FilterFormElement";

// The declarative renderer: it renders a `ui_spec` (rows of typed
// display elements) purely from JSON, binding each element's trusted
// data via `dataRef` into ui_data. Every element type maps to one
// shadcn-based renderer below; the layout is a flex row per ui_spec
// row, with per-cell width weights.
function RenderElement({
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
      return <ChartElement component={component} data={data} />;
    case "table":
      return <TableElement component={component} data={data} />;
    case "markdown":
      return <MarkdownElement component={component} />;
    case "kpi":
      return <KpiElement component={component} data={data} />;
    case "download":
      return <DownloadElement component={component} data={data} />;
    case "input_form":
      return <FilterFormElement component={component} data={data} onApplyFilters={onApplyFilters} />;
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
    <div className="mt-3 flex flex-col gap-3">
      {spec.layout.rows.map((row, i) => (
        <div
          key={i}
          className={cn("grid gap-3", row.columns.length > 1 ? "sm:grid-flow-col" : "")}
          style={
            row.columns.length > 1
              ? {
                  gridTemplateColumns: row.columns
                    .map((c) => `${c.width ?? 1}fr`)
                    .join(" "),
                }
              : undefined
          }
        >
          {row.columns.map((cell) => {
            const component = byId.get(cell.componentId);
            if (!component) return null;
            return (
              <div key={cell.componentId} className="min-w-0">
                <RenderElement component={component} data={data} onApplyFilters={onApplyFilters} />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
