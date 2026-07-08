import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentSubscriber } from "@ag-ui/client";
import { aguiAgent } from "./agent";
import { A2UISurface } from "./a2ui/A2UISurface";
import { ApplyFiltersContext } from "./a2ui/ApplyFiltersContext";

const SESSION_START = "[UI_ACTION session_start]";

// A short bubble summary of an applied filter set (the raw action
// payload is never shown to the user).
function summarizeFilters(values: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === null || v === false || v === "") continue;
    if (Array.isArray(v)) {
      if (v.length) parts.push(`${k}: ${v.join(", ")}`);
    } else if (v === true) {
      parts.push(k);
    } else {
      parts.push(`${k}: ${v}`);
    }
  }
  return parts.length ? `Applied filters — ${parts.join(" · ")}` : "Cleared all filters";
}

const RESULT_PREVIEW_LIMIT = 1500;

function ReasoningStepView({ step }: { step: ReasoningStep }) {
  const truncatable = step.result && step.result.length > RESULT_PREVIEW_LIMIT;
  const [expanded, setExpanded] = useState(false);
  const shown =
    truncatable && !expanded ? step.result.slice(0, RESULT_PREVIEW_LIMIT) + "…" : step.result;
  return (
    <div className="reasoning-step">
      <div className="reasoning-tool">
        Called <code>{step.tool}</code>
      </div>
      <pre className="reasoning-args">{JSON.stringify(step.args, null, 2)}</pre>
      <div className="reasoning-result-label">Result</div>
      <pre className="reasoning-result">{shown}</pre>
      {truncatable && (
        <button className="reasoning-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show less" : "Show full result"}
        </button>
      )}
    </div>
  );
}

// The collapsible "Reasoning" panel: the MCP tool calls (name, args,
// result) the agent made this turn - mirrors one_search_ui's reasoning
// log, so users can inspect exactly which trusted data drove the UI.
function ReasoningLog({ steps }: { steps: ReasoningStep[] }) {
  const [open, setOpen] = useState(false);
  if (!steps || steps.length === 0) return null;
  return (
    <div className="reasoning">
      <button className="reasoning-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "▾ Reasoning" : `▸ Reasoning (${steps.length} tool call${steps.length > 1 ? "s" : ""})`}
      </button>
      {open && (
        <div className="reasoning-log">
          {steps.map((step, i) => (
            <ReasoningStepView key={i} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}

interface ReasoningStep {
  tool: string;
  args: Record<string, unknown>;
  result: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  a2uiMessages: unknown[] | null;
  reasoning: ReasoningStep[];
}

function makeMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return { id: crypto.randomUUID(), role, content, a2uiMessages: null, reasoning: [] };
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const greetedRef = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  // tool_call_id -> {name, args}, so result events (which carry only the
  // id) can be matched back to the call that produced them.
  const toolCallById = useRef(new Map<string, { name: string; args: Record<string, unknown> }>());

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Greet once on load: fire the hidden session_start so the agent
  // welcomes the user with their access summary + vuln breakdown.
  useEffect(() => {
    if (greetedRef.current) return;
    greetedRef.current = true;
    void send(SESSION_START);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(overrideText?: string, displayText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;

    // Hide the raw sentinel for [UI_ACTION ...] messages; show a friendly
    // bubble only if a displayText was provided (e.g. filter refinements).
    const isAction = text.startsWith("[UI_ACTION ");
    if (!isAction) {
      setMessages((prev) => [...prev, makeMessage("user", text)]);
    } else if (displayText) {
      setMessages((prev) => [...prev, makeMessage("user", displayText)]);
    }
    setInput("");
    setLoading(true);

    const assistant = makeMessage("assistant", "");
    setMessages((prev) => [...prev, assistant]);
    const update = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((prev) => prev.map((m) => (m.id === assistant.id ? fn(m) : m)));

    aguiAgent.messages.push({ id: crypto.randomUUID(), role: "user", content: text });

    const subscriber: AgentSubscriber = {
      onTextMessageContentEvent({ textMessageBuffer }) {
        update((m) => ({ ...m, content: textMessageBuffer }));
      },
      onToolCallStartEvent({ event }) {
        toolCallById.current.set(event.toolCallId, { name: event.toolCallName, args: {} });
      },
      onToolCallEndEvent({ event, toolCallArgs }) {
        const entry = toolCallById.current.get(event.toolCallId);
        if (entry) entry.args = toolCallArgs;
      },
      onToolCallResultEvent({ event }) {
        const entry = toolCallById.current.get(event.toolCallId);
        update((m) => ({
          ...m,
          reasoning: [
            ...m.reasoning,
            {
              tool: entry?.name || "unknown",
              args: entry?.args || {},
              result: String(event.content),
            },
          ],
        }));
      },
    };

    try {
      await aguiAgent.runAgent({}, subscriber);
      const state = aguiAgent.state as { a2ui_messages?: unknown[] | null };
      if (state?.a2ui_messages) {
        update((m) => ({ ...m, a2uiMessages: state.a2ui_messages! }));
      }
    } catch (err) {
      update((m) => ({ ...m, content: `Error: ${(err as Error).message}` }));
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // Wired into the a2ui Filter component via context: Apply sends a
  // filter-refinement action to the agent (raw payload hidden; a short
  // summary bubble is shown instead).
  const handleApplyFilters = useCallback((values: Record<string, unknown>) => {
    void send(`[UI_ACTION apply_filters] ${JSON.stringify(values)}`, summarizeFilters(values));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ApplyFiltersContext.Provider value={handleApplyFilters}>
    <div className="app">
      <header className="app-header">
        <span className="app-brand">A2UI Vulnerability Assistant</span>
        <span className="app-sub">UI generated by the agent · rendered with @a2ui/react</span>
      </header>

      <div className="chat">
        {messages.map((m) => (
          <div key={m.id} className={`row ${m.role}`}>
            {m.role === "user" ? (
              <div className="bubble">{m.content}</div>
            ) : (
              <div className="assistant">
                {m.content && (
                  <div className="assistant-text">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  </div>
                )}
                {m.a2uiMessages && <A2UISurface messages={m.a2uiMessages} />}
                <ReasoningLog steps={m.reasoning} />
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="row assistant">
            <div className="typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="input-bar">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="e.g. Show critical vulnerabilities for my applications"
          rows={1}
        />
        <button onClick={() => send()} disabled={loading || !input.trim()}>
          Send
        </button>
      </div>
    </div>
    </ApplyFiltersContext.Provider>
  );
}
