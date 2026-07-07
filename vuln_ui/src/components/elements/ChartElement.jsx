// Renders the "chart" display element with Recharts (shadcn chart style).
import {
  Area,
  AreaChart,
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
import { Card, CardHeader, CardContent } from "../ui/primitives.jsx";

const FALLBACK = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"];

function resolveColor(color, i) {
  const token = color || `var(${FALLBACK[i % FALLBACK.length]})`;
  const match = /^var\((--[\w-]+)\)$/.exec(token);
  if (match) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
    return v || "#3b82f6";
  }
  return token;
}

export default function ChartElement({ element }) {
  const { variant, data = [], series = [], x_key: xKey, stacked, horizontal } = element;
  const height = element.height || 280;

  let chart = null;
  if (variant === "pie" || variant === "donut") {
    const valueKey = series[0]?.key || "count";
    chart = (
      <PieChart>
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey={xKey}
          innerRadius={variant === "donut" ? "55%" : 0}
          outerRadius="85%"
          paddingAngle={2}
          strokeWidth={1}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={resolveColor(null, i)} />
          ))}
        </Pie>
        <Tooltip />
        <Legend verticalAlign="bottom" height={28} iconSize={10} />
      </PieChart>
    );
  } else if (variant === "bar") {
    chart = (
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"}>
        <CartesianGrid strokeDasharray="3 3" vertical={!horizontal} horizontal={horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey={xKey} width={120} tick={{ fontSize: 11 }} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
          </>
        )}
        <Tooltip />
        {series.length > 1 && <Legend iconSize={10} />}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label || s.key}
            fill={resolveColor(s.color, i)}
            stackId={stacked ? "stack" : undefined}
            radius={[3, 3, 0, 0]}
          />
        ))}
      </BarChart>
    );
  } else {
    const ChartComp = variant === "area" ? AreaChart : LineChart;
    chart = (
      <ChartComp data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend iconSize={10} />
        {series.map((s, i) =>
          variant === "area" ? (
            <Area
              key={s.key}
              dataKey={s.key}
              name={s.label || s.key}
              stroke={resolveColor(s.color, i)}
              fill={resolveColor(s.color, i)}
              fillOpacity={0.2}
              stackId={stacked ? "stack" : undefined}
            />
          ) : (
            <Line
              key={s.key}
              dataKey={s.key}
              name={s.label || s.key}
              stroke={resolveColor(s.color, i)}
              strokeWidth={2}
              dot={{ r: 2.5 }}
            />
          )
        )}
      </ChartComp>
    );
  }

  return (
    <Card>
      <CardHeader title={element.title} description={element.description} />
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          {chart}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
