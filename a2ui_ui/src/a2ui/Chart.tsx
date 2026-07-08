// The custom A2UI "Chart" visualization (a2ui's basicCatalog ships no
// charting primitive). This file owns both the Recharts render and the
// a2ui component registration - catalog.tsx just imports
// `ChartImplementation`.
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { z } from "zod";
import type { ComponentApi } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { TrustBadge } from "./TrustBadge";
import type { ElementMeta } from "./manifest";

export type ChartType = "bar" | "horizontalBar" | "line" | "pie" | "donut";

// The AUTHORING contract the agent's LLM fills for a chart element, plus
// its metadata - shared with the agent via the generated manifest.
// Prefer `dataRef` (trusted binding); inline xKey/series/data is the
// untrusted fallback.
export const chartElementSchema = z.object({
  chartType: z.enum(["bar", "horizontalBar", "line", "pie", "donut"]),
  title: z.string(),
  dataRef: z.string().optional().describe("Dotted path to trusted data (preferred)."),
  xKey: z.string().optional().describe("Label field name (inline fallback)."),
  series: z.array(z.string()).optional().describe("Value field name(s) (inline)."),
  data: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe("Inline data ONLY if no dataRef fits (untrusted)."),
});

export const chartMeta: ElementMeta = {
  type: "chart",
  component: "Chart",
  placement: "combinable",
  dataRefProps: ["dataRef"],
  dataBinding: null,
};

export interface ChartSpec {
  chartType: ChartType;
  title: string;
  xKey: string;
  series: string[];
  data: Record<string, unknown>[];
  // true when the data was bound by reference to trusted MCP output;
  // false when the LLM supplied it inline (AI-generated).
  trusted?: boolean;
}

const SEVERITY_COLORS: Record<string, string> = {
  Critical: "#ef4444",
  High: "#f59e0b",
  Medium: "#eab308",
  Low: "#3b82f6",
};
const PALETTE = ["#8ab4ff", "#4ade80", "#f87171", "#fbbf24", "#c084fc", "#2dd4bf", "#fb923c"];

function colorFor(label: string, i: number) {
  return SEVERITY_COLORS[label] ?? PALETTE[i % PALETTE.length];
}

const tooltipStyle = {
  contentStyle: { background: "#1e1e20", border: "1px solid #2e2e31", borderRadius: 8 },
  labelStyle: { color: "#ececec" },
};

function ChartHeader({ title, trusted }: { title: string; trusted?: boolean }) {
  return (
    <div className="a2ui-viz-header">
      <span className="a2ui-chart-title">{title}</span>
      <TrustBadge trusted={trusted} />
    </div>
  );
}

export function Chart({ spec }: { spec: ChartSpec }) {
  const { chartType, title, xKey, series, data, trusted } = spec;
  if (!data || data.length === 0 || series.length === 0) {
    return (
      <div className="a2ui-chart">
        <ChartHeader title={title} trusted={trusted} />
        <div className="a2ui-chart-empty">No data</div>
      </div>
    );
  }

  const isPie = chartType === "pie" || chartType === "donut";
  const horizontal = chartType === "horizontalBar";

  return (
    <div className="a2ui-chart">
      <ChartHeader title={title} trusted={trusted} />
      <ResponsiveContainer width="100%" height={isPie ? 220 : 260}>
        {isPie ? (
          <PieChart>
            <Pie
              data={data}
              dataKey={series[0]}
              nameKey={xKey}
              innerRadius={chartType === "donut" ? "55%" : 0}
              outerRadius="85%"
              stroke="#1a1a1c"
            >
              {data.map((row, i) => (
                <Cell key={i} fill={colorFor(String(row[xKey]), i)} />
              ))}
            </Pie>
            <Tooltip {...tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} iconSize={10} />
          </PieChart>
        ) : chartType === "line" ? (
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#2e2e31" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fill: "#9b9ba1", fontSize: 12 }} />
            <YAxis tick={{ fill: "#9b9ba1", fontSize: 12 }} width={36} />
            <Tooltip {...tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
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
        ) : (
          <BarChart
            data={data}
            layout={horizontal ? "vertical" : "horizontal"}
            margin={{ top: 8, right: 12, left: horizontal ? 12 : 0, bottom: 0 }}
          >
            <CartesianGrid stroke="#2e2e31" strokeDasharray="3 3" vertical={horizontal} horizontal={!horizontal} />
            {horizontal ? (
              <>
                <XAxis type="number" tick={{ fill: "#9b9ba1", fontSize: 12 }} />
                <YAxis type="category" dataKey={xKey} width={120} tick={{ fill: "#9b9ba1", fontSize: 12 }} />
              </>
            ) : (
              <>
                <XAxis dataKey={xKey} tick={{ fill: "#9b9ba1", fontSize: 12 }} />
                <YAxis tick={{ fill: "#9b9ba1", fontSize: 12 }} width={36} />
              </>
            )}
            <Tooltip {...tooltipStyle} />
            {series.map((key, i) => (
              <Bar key={key} dataKey={key} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}>
                {series.length === 1 &&
                  data.map((row, j) => <Cell key={j} fill={colorFor(String(row[xKey]), j)} />)}
                {series.length > 1 && <Cell fill={PALETTE[i % PALETTE.length]} />}
              </Bar>
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

// --- a2ui component registration ---
const ChartApi: ComponentApi = {
  name: "Chart",
  schema: z
    .object({
      chartType: z.enum(["bar", "horizontalBar", "line", "pie", "donut"]),
      title: z.string(),
      xKey: z.string(),
      series: z.array(z.string()),
      data: z.array(z.record(z.string(), z.unknown())),
      trusted: z.boolean().optional(),
      weight: z.number().optional(),
    })
    .strict(),
};

export const ChartImplementation = createComponentImplementation(ChartApi, ({ props }) => (
  // a2ui's built-in components apply their own `weight` as flex; custom
  // components must too (the framework doesn't inject it) so a Chart in a
  // Row shares width evenly with its siblings.
  <div style={typeof props.weight === "number" ? { flex: `${props.weight}`, minWidth: 0 } : undefined}>
    <Chart
      spec={{
        chartType: props.chartType as ChartType,
        title: props.title as string,
        xKey: props.xKey as string,
        series: props.series as string[],
        data: props.data as Record<string, unknown>[],
        trusted: props.trusted as boolean | undefined,
      }}
    />
  </div>
));
