// Declarative UI rendering model (see one_search_agent/agent.py's
// _build_ui_data/_build_ui_spec): the agent describes WHAT to render
// (layout + component types + which trusted dataset to bind), and the
// UI decides HOW. ui_data is the trusted dataset registry; ui_spec's
// components reference it by dataRef instead of embedding values.

import type { ChartType } from "../dashboard/types";

// Keyed by tool name (e.g. "get_vulnerability_summary"), plus a
// synthetic "_filters" entry - see agent.py's _build_ui_data. Values
// are copied VERBATIM from MCP tool results, never reshaped here.
export type UIData = Record<string, unknown>;

export interface UIChartConfig {
  chartType: ChartType;
  // Field names within the resolved dataRef value, NOT data. Omitted
  // for breakdown-shaped (label -> count object) data, which the
  // resolver auto-converts - see resolveDataRef.ts.
  xKey?: string;
  series?: string[];
}

export interface UITableColumn {
  key: string;
  label: string;
}

// "kpi" and "download" are presentation-specific extensions of the
// core chart/table/markdown/input_form taxonomy - both still carry a
// dataRef into trusted ui_data (a {title,value}[] list and a raw
// export object respectively) rather than embedding values, so they
// follow the same data-trust rule, just with a dedicated look instead
// of being squeezed into a generic chart/table/markdown rendering.
export type UIComponentType = "chart" | "table" | "markdown" | "input_form" | "kpi" | "download";

export interface UIComponent {
  id: string;
  type: UIComponentType;
  title?: string;
  // chart/table/input_form/kpi/download: a dotted path into UIData
  // (e.g. "get_vulnerability_summary.breakdowns.severity_breakdown").
  dataRef?: string;
  chart?: UIChartConfig;
  columns?: UITableColumn[];
  // markdown only - the one field allowed to be free-form/AI-authored
  // text not bound to a trusted dataset.
  markdown?: string;
  // input_form only - identifies which predefined form schema to
  // render; today only "vulnerability_filters" exists.
  formId?: string;
}

export interface UIGridCell {
  componentId: string;
  width?: number;
}

export interface UIRow {
  columns: UIGridCell[];
}

export interface UISpec {
  layout: { rows: UIRow[] };
  components: UIComponent[];
}
