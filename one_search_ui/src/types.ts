import type { Dashboard } from "./dashboard/types";

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
  reasoning: ReasoningStep[];
}

export function makeMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return { id: crypto.randomUUID(), role, content, dashboard: null, reasoning: [] };
}
