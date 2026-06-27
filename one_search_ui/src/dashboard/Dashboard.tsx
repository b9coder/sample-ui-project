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
  return (
    <div className="dashboard-wrap">
      <KPICards items={data.kpis} />
      {data.charts.map((spec, i) => (
        <Chart key={i} spec={spec} />
      ))}
      <FilterPanel spec={data.filters} onApply={onApplyFilters} />
      <Table spec={data.table} />
      <DownloadCard spec={data.download} />
    </div>
  );
}
