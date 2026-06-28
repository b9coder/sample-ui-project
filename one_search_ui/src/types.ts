import type { Dashboard, TableSpec } from "./dashboard/types";

export interface ReasoningStep {
  tool: string;
  args: Record<string, unknown>;
  result: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  dashboard: Dashboard | null;
  // Raw vulnerability rows, shown as their own panel separate from the
  // KPI/chart dashboard - covers both an analytics search (where
  // get_vulnerability_records is called alongside the summary) and a
  // plain listing request ("show me vulnerabilities for app X").
  recordsTable: TableSpec | null;
  reasoning: ReasoningStep[];
}

export function makeMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    dashboard: null,
    recordsTable: null,
    reasoning: [],
  };
}
