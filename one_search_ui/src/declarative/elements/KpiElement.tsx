import { Card, CardContent } from "@/components/ui/card";
import type { KPIItem } from "../../dashboard/types";
import type { UIComponent, UIData } from "../types";
import { resolveDataRef } from "../resolveDataRef";

export function KpiElement({ component, data }: { component: UIComponent; data: UIData }) {
  const resolved = resolveDataRef(data, component.dataRef);
  const items = Array.isArray(resolved) ? (resolved as KPIItem[]) : [];
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((item, i) => (
        <Card key={i} className="gap-1 py-4">
          <CardContent className="px-4">
            <div className="text-2xl font-semibold tabular-nums">
              {typeof item.value === "number" ? item.value.toLocaleString() : item.value}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{item.title}</div>
            {item.trend && <div className="mt-1 text-xs text-chart-2">{item.trend}</div>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
