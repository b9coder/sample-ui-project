export interface KPIItem {
  title: string;
  value: number | string;
  trend?: string;
}

export type ChartType = "bar" | "horizontalBar" | "pie" | "donut" | "line";

export interface ChartSpec {
  chartType: ChartType;
  title: string;
  xKey: string;
  series: string[];
  data: Record<string, unknown>[];
}

export type FilterFieldType = "multiSelect" | "checkbox" | "text" | "select";

export interface FilterField {
  name: string;
  label: string;
  component: FilterFieldType;
  options?: string[];
}

export interface FilterPanelSpec {
  fields: FilterField[];
  values: Record<string, unknown>;
}

export interface TableColumn {
  key: string;
  label: string;
}

export interface TableSpec {
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  pageSize?: number;
}

export interface DownloadSpec {
  title?: string;
  fileName: string;
  downloadUrl: string | null;
  recordCount?: number;
}

export interface Dashboard {
  kpis: KPIItem[];
  charts: ChartSpec[];
  filters: FilterPanelSpec;
  table: TableSpec;
  download: DownloadSpec;
}
