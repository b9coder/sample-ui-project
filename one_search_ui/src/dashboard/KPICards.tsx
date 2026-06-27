import type { KPIItem } from "./types";

export function KPICards({ items }: { items: KPIItem[] }) {
  return (
    <div className="osa-kpi-row">
      {items.map((item, i) => (
        <div key={i} className="osa-kpi-tile">
          <div className="osa-kpi-value">{item.value}</div>
          <div className="osa-kpi-title">{item.title}</div>
          {item.trend && <div className="osa-kpi-trend">{item.trend}</div>}
        </div>
      ))}
    </div>
  );
}
