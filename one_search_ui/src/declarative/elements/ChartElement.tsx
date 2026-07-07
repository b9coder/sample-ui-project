import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { UIComponent, UIData } from "../types";
import { resolveDataRef, toChartRows } from "../resolveDataRef";

// Severity gets fixed, meaningful colors; everything else cycles the
// theme chart palette (--chart-1..5 from index.css).
const SEVERITY_COLORS: Record<string, string> = {
  Critical: "var(--chart-4)",
  High: "var(--chart-3)",
  Medium: "oklch(0.75 0.15 90)",
  Low: "var(--chart-1)",
};
const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function colorFor(label: string, index: number): string {
  return SEVERITY_COLORS[label] ?? PALETTE[index % PALETTE.length];
}

export function ChartElement({ component, data }: { component: UIComponent; data: UIData }) {
  const resolved = resolveDataRef(data, component.dataRef);
  const { rows, xKey } = toChartRows(resolved, component.chart?.xKey);
  const series = component.chart?.series ?? (rows.length > 0 && "value" in rows[0] ? ["value"] : []);
  const chartType = component.chart?.chartType;

  const config = useMemo<ChartConfig>(() => {
    const c: ChartConfig = {};
    series.forEach((key, i) => {
      c[key] = { label: key.replace(/_/g, " "), color: PALETTE[i % PALETTE.length] };
    });
    rows.forEach((row, i) => {
      const label = String(row[xKey] ?? "");
      if (label) c[label] = { label, color: colorFor(label, i) };
    });
    return c;
  }, [series, rows, xKey]);

  const body = () => {
    if (!chartType || rows.length === 0 || series.length === 0) {
      return (
        <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
          No data
        </div>
      );
    }

    if (chartType === "pie" || chartType === "donut") {
      return (
        <ChartContainer config={config} className="mx-auto aspect-square max-h-[220px]">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey={xKey} hideLabel />} />
            <Pie
              data={rows}
              dataKey={series[0]}
              nameKey={xKey}
              innerRadius={chartType === "donut" ? "55%" : 0}
              outerRadius="85%"
              strokeWidth={2}
              stroke="var(--card)"
            >
              {rows.map((row, i) => (
                <Cell key={i} fill={colorFor(String(row[xKey]), i)} />
              ))}
            </Pie>
            <ChartLegend content={<ChartLegendContent nameKey={xKey} />} />
          </PieChart>
        </ChartContainer>
      );
    }

    if (chartType === "line") {
      return (
        <ChartContainer config={config} className="aspect-auto h-[240px] w-full">
          <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis width={36} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            {series.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={PALETTE[i % PALETTE.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
      );
    }

    const horizontal = chartType === "horizontalBar";
    return (
      <ChartContainer config={config} className="aspect-auto h-[240px] w-full">
        <BarChart
          data={rows}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{ top: 8, right: 12, left: horizontal ? 12 : 0, bottom: 0 }}
        >
          <CartesianGrid horizontal={!horizontal} vertical={horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" tickLine={false} axisLine={false} />
              <YAxis
                type="category"
                dataKey={xKey}
                width={120}
                tickLine={false}
                axisLine={false}
              />
            </>
          ) : (
            <>
              <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis width={36} tickLine={false} axisLine={false} />
            </>
          )}
          <ChartTooltip content={<ChartTooltipContent />} />
          {series.map((key, i) => (
            <Bar key={key} dataKey={key} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}>
              {rows.map((row, j) => (
                <Cell
                  key={j}
                  fill={series.length === 1 ? colorFor(String(row[xKey]), j) : PALETTE[i % PALETTE.length]}
                />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ChartContainer>
    );
  };

  return (
    <Card className="h-full gap-3 py-4">
      {component.title && (
        <CardHeader className="px-4">
          <CardTitle className="text-sm text-muted-foreground">{component.title}</CardTitle>
        </CardHeader>
      )}
      <CardContent className="px-4">{body()}</CardContent>
    </Card>
  );
}
