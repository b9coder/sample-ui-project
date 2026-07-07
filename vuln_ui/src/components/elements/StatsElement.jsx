import clsx from "clsx";
import { Card, CardContent } from "../ui/primitives.jsx";

const intentClass = {
  default: "text-foreground",
  success: "text-emerald-600",
  warning: "text-amber-600",
  danger: "text-red-600",
};

export default function StatsElement({ element }) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(${Math.min(element.items.length, 5)}, minmax(0, 1fr))` }}
    >
      {element.items.map((item, i) => (
        <Card key={i}>
          <CardContent className="py-3">
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className={clsx("mt-1 text-2xl font-semibold tabular-nums", intentClass[item.intent || "default"])}>
              {typeof item.value === "number" ? item.value.toLocaleString() : item.value}
            </p>
            {item.hint && <p className="mt-0.5 text-xs text-muted-foreground">{item.hint}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
