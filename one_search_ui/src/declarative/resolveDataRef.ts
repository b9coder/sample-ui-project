import type { UIData } from "./types";

// Resolves a dotted dataRef path (e.g.
// "get_vulnerability_summary.breakdowns.severity_breakdown") against
// the trusted UIData registry. Pure lookup - never mutates or
// reshapes the underlying value.
export function resolveDataRef(data: UIData | null | undefined, dataRef: string | undefined): unknown {
  if (!data || !dataRef) return undefined;
  let current: unknown = data;
  for (const segment of dataRef.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

// Generic, content-blind adapter so chart-binding works whether the
// resolved value is already an array of records (xKey/series name
// real fields) or a breakdown-shaped object map (label -> count) -
// the latter is converted to [{label, value}] pairs using a fixed
// convention, not by inspecting/altering the actual numbers.
export function toChartRows(
  value: unknown,
  xKey?: string
): { rows: Record<string, unknown>[]; xKey: string } {
  if (Array.isArray(value)) {
    return { rows: value as Record<string, unknown>[], xKey: xKey ?? "label" };
  }
  if (value && typeof value === "object") {
    const rows = Object.entries(value as Record<string, unknown>).map(([label, v]) => ({
      label,
      value: v,
    }));
    return { rows, xKey: "label" };
  }
  return { rows: [], xKey: xKey ?? "label" };
}
