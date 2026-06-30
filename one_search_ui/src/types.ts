import type { Dashboard, TableSpec } from "./dashboard/types";
import type { UIData, UISpec } from "./declarative/types";

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
  // Declarative-UI counterpart to dashboard/recordsTable above - the
  // agent always populates this alongside them (see agent.py's
  // _build_ui_data/_build_ui_spec); which one actually renders is a
  // frontend choice, see App.tsx's UI_RENDER_MODE.
  uiSpec: UISpec | null;
  uiData: UIData | null;
  reasoning: ReasoningStep[];
}

export function makeMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    dashboard: null,
    recordsTable: null,
    uiSpec: null,
    uiData: null,
    reasoning: [],
  };
}
