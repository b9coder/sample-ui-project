import type { Dashboard as DashboardData } from "./types";
import { KPICards } from "./KPICards";
import { Chart } from "./Chart";
import { FilterPanel } from "./FilterPanel";
import { Table } from "./Table";
import { DownloadCard } from "./DownloadCard";

export function Dashboard({
  data,
  onApplyFilters,
}: {
  data: DashboardData;
  onApplyFilters: (values: Record<string, unknown>) => void;
}) {
  const donutCharts = data.charts.filter((c) => c.chartType === "donut" || c.chartType === "pie");
  const otherCharts = data.charts.filter((c) => c.chartType !== "donut" && c.chartType !== "pie");

  return (
    <div className="dashboard-wrap">
      <KPICards items={data.kpis} />
      {donutCharts.length > 0 && (
        <div className="osa-chart-row">
          {donutCharts.map((spec, i) => (
            <Chart key={i} spec={spec} />
          ))}
        </div>
      )}
      {otherCharts.map((spec, i) => (
        <Chart key={i} spec={spec} />
      ))}
      <FilterPanel spec={data.filters} onApply={onApplyFilters} />
      <Table spec={data.table} />
      <DownloadCard spec={data.download} />
    </div>
  );
}
