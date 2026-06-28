// Maps the FilterPanel's field `name`s (see agent.py's FILTER_FIELDS) to
// a human-readable label - used both to summarize an apply_filters
// action in the chat bubble, and to show "what criteria produced this
// output" above a dashboard.
export const FILTER_FIELD_LABELS: Record<string, string> = {
  severity: "Severity",
  application: "Application",
  businessUnit: "Business Unit",
  owner: "Owner",
  operatingSystem: "Operating System",
  environment: "Environment",
  region: "Region",
  isPastDue: "Past Due",
  isEscalated: "Escalated",
  internetFacing: "Internet Facing",
  kernelRelated: "Kernel Related",
  specificServer: "Specific Server",
};

export function describeFilterValues(values: Record<string, unknown>): string[] {
  return Object.entries(values)
    .filter(([, value]) => value !== "" && value !== null && value !== undefined)
    .filter(([, value]) => !(Array.isArray(value) && value.length === 0))
    .map(([key, value]) => {
      const label = FILTER_FIELD_LABELS[key] ?? key;
      const display = Array.isArray(value) ? value.join(", ") : String(value);
      return `${label}: ${display}`;
    });
}

export function summarizeFilters(values: Record<string, unknown>): string {
  const parts = describeFilterValues(values);
  return parts.length > 0 ? `Applied filters — ${parts.join(", ")}` : "Cleared all filters";
}
