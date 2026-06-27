import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

const SERIES_COLORS = ["#8ab4ff", "#4ade80", "#f87171", "#fbbf24", "#c084fc", "#2dd4bf", "#fb923c", "#f472b6"];

const SERIES_LABELS = {
  discovered: "Discovered",
  remediated: "Remediated",
  past_due: "Past due",
  escalated: "Escalated",
  risk_score: "Risk score",
  value: "Count",
};

function label(key) {
  return SERIES_LABELS[key] || key;
}

const tooltipStyle = {
  contentStyle: { background: "#1e1e20", border: "1px solid #2e2e31", borderRadius: 8 },
  labelStyle: { color: "#ececec" },
};

export default function Chart({ spec }) {
  if (!spec || !spec.data || spec.data.length === 0) return null;

  const height = 280;

  return (
    <div className="chart-wrap">
      <div className="chart-title">{spec.title}</div>
      <ResponsiveContainer width="100%" height={height}>
        {spec.type === "line" ? (
          <LineChart data={spec.data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#2e2e31" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey={spec.x_key} tick={{ fill: "#9b9ba1", fontSize: 11 }} />
            <YAxis tick={{ fill: "#9b9ba1", fontSize: 11 }} width={32} />
            <Tooltip {...tooltipStyle} />
            <Legend formatter={label} wrapperStyle={{ fontSize: 12 }} />
            {spec.series.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={label(key)}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        ) : spec.type === "donut" ? (
          <PieChart margin={{ top: 8, right: 12, left: 12, bottom: 8 }}>
            <Pie
              data={spec.data}
              dataKey={spec.series[0]}
              nameKey={spec.x_key}
              innerRadius="55%"
              outerRadius="85%"
              paddingAngle={2}
              strokeWidth={0}
            >
              {spec.data.map((_, i) => (
                <Cell key={i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip {...tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        ) : (
          <BarChart data={spec.data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#2e2e31" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey={spec.x_key}
              tick={{ fill: "#9b9ba1", fontSize: 11 }}
              interval={0}
              angle={spec.data.length > 6 ? -30 : 0}
              textAnchor={spec.data.length > 6 ? "end" : "middle"}
              height={spec.data.length > 6 ? 50 : 24}
            />
            <YAxis tick={{ fill: "#9b9ba1", fontSize: 11 }} width={32} />
            <Tooltip {...tooltipStyle} />
            {spec.series.map((key, i) => (
              <Bar
                key={key}
                dataKey={key}
                name={label(key)}
                fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                radius={[4, 4, 0, 0]}
              />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
