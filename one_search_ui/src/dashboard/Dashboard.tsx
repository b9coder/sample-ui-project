import type { Dashboard as DashboardData } from "./types";
import { KPICards } from "./KPICards";
import { Chart } from "./Chart";
import { FilterPanel } from "./FilterPanel";
import { DownloadCard } from "./DownloadCard";
import { describeFilterValues } from "./filterLabels";

export function Dashboard({
  data,
  onApplyFilters,
}: {
  data: DashboardData;
  onApplyFilters: (values: Record<string, unknown>) => void;
}) {
  const donutCharts = data.charts.filter((c) => c.chartType === "donut" || c.chartType === "pie");
  const otherCharts = data.charts.filter((c) => c.chartType !== "donut" && c.chartType !== "pie");
  // The filter values that actually PRODUCED this output - shown as a
  // fixed record here so it stays correct even after the FilterPanel
  // below (which seeds new searches, not this one) is changed by the
  // user for the next turn.
  const appliedCriteria = data.download ? describeFilterValues(data.filters.values) : [];

  return (
    <div className="dashboard-wrap">
      {data.download && (
        <div className="osa-criteria">
          <span className="osa-criteria-label">Criteria:</span>{" "}
          {appliedCriteria.length > 0 ? appliedCriteria.join(" · ") : "All applications, no filters"}
        </div>
      )}
      {data.kpis.length > 0 && <KPICards items={data.kpis} />}
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
      {data.download && (
        <>
          <DownloadCard spec={data.download} />
          <div className="osa-next-steps">
            <div className="osa-next-steps-label">Refine the filters below to see updated results</div>
            <FilterPanel spec={data.filters} onApply={onApplyFilters} />
          </div>
        </>
      )}
    </div>
  );
}
