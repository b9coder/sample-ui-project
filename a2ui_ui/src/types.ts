export interface ReasoningStep {
  tool: string;
  args: Record<string, unknown>;
  result: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  // Backend-generated a2ui.org message list for this turn's visual surface.
  a2uiMessages: unknown[] | null;
  // The agent's MCP tool calls this turn (for the Reasoning panel).
  reasoning: ReasoningStep[];
  // Related follow-up questions to show as clickable chips.
  suggestions: string[];
}

export function makeMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    a2uiMessages: null,
    reasoning: [],
    suggestions: [],
  };
}
