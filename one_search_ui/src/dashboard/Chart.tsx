import {
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { PieLabelRenderProps } from "recharts";
import type { ChartSpec } from "./types";

const COLORS = ["#8ab4ff", "#4ade80", "#f87171", "#fbbf24", "#c084fc", "#2dd4bf", "#fb923c"];

const SEVERITY_COLORS: Record<string, string> = {
  Critical: "#ef4444", // red
  High: "#f59e0b", // amber
  Medium: "#eab308", // yellow
  Low: "#3b82f6", // blue
};

function isSeverityData(data: Record<string, unknown>[], xKey: string): boolean {
  return data.length > 0 && data.every((d) => typeof d[xKey] === "string" && d[xKey] in SEVERITY_COLORS);
}

const tooltipStyle = {
  contentStyle: { background: "#1e1e20", border: "1px solid #2e2e31", borderRadius: 8 },
  labelStyle: { color: "#ececec" },
};

// Recharts' default pie label draws outside the ring with a leader line,
// which gets clipped by the container at the compact sizes used when
// several donuts sit side by side. Render the value INSIDE the ring
// instead - it can never overflow.
function renderInsideLabel(props: PieLabelRenderProps) {
  const cx = Number(props.cx);
  const cy = Number(props.cy);
  const midAngle = Number(props.midAngle);
  const innerRadius = Number(props.innerRadius);
  const outerRadius = Number(props.outerRadius);
  const value = props.value;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
      {value}
    </text>
  );
}

export function Chart({ spec }: { spec: ChartSpec }) {
  const { chartType, title, xKey, series, data } = spec;

  if (!data || data.length === 0) {
    return (
      <div className="osa-chart-wrap">
        <div className="osa-chart-title">{title}</div>
        <div className="osa-chart-empty">No data</div>
      </div>
    );
  }

  return (
    <div className="osa-chart-wrap">
      <div className="osa-chart-title">{title}</div>
      <ResponsiveContainer width="100%" height={chartType === "pie" || chartType === "donut" ? 190 : 260}>
        {chartType === "pie" || chartType === "donut" ? (
          <PieChart margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <Pie
              data={data}
              dataKey={series[0]}
              nameKey={xKey}
              innerRadius={chartType === "donut" ? "52%" : 0}
              outerRadius="85%"
              label={renderInsideLabel}
              labelLine={false}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip {...tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} iconSize={9} />
          </PieChart>
        ) : chartType === "line" ? (
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#2e2e31" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fill: "#9b9ba1", fontSize: 11 }} />
            <YAxis tick={{ fill: "#9b9ba1", fontSize: 11 }} width={32} />
            <Tooltip {...tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {series.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        ) : chartType === "horizontalBar" ? (
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 8, right: 12, left: 12, bottom: 0 }}
          >
            <CartesianGrid stroke="#2e2e31" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fill: "#9b9ba1", fontSize: 11 }} />
            <YAxis
              dataKey={xKey}
              type="category"
              tick={{ fill: "#9b9ba1", fontSize: 11 }}
              width={110}
            />
            <Tooltip {...tooltipStyle} />
            {series.map((key, i) => (
              <Bar key={key} dataKey={key} fill={COLORS[i % COLORS.length]} radius={[0, 4, 4, 0]} />
            ))}
          </BarChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#2e2e31" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fill: "#9b9ba1", fontSize: 11 }} />
            <YAxis tick={{ fill: "#9b9ba1", fontSize: 11 }} width={32} />
            <Tooltip {...tooltipStyle} />
            {series.map((key, i) => (
              <Bar key={key} dataKey={key} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]}>
                {isSeverityData(data, xKey) &&
                  data.map((d, j) => (
                    <Cell key={j} fill={SEVERITY_COLORS[d[xKey] as string]} />
                  ))}
              </Bar>
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
