import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentSubscriber } from "@ag-ui/client";
import { aguiAgent } from "./agent";
import { Dashboard } from "./dashboard/Dashboard";
import type { Dashboard as DashboardData } from "./dashboard/types";
import { makeMessage, type ChatMessage, type ReasoningStep } from "./types";
import { stripLeakedComponentJson } from "./sanitizeReply";
import "./App.css";

// Maps the FilterPanel's field `name`s (see agent.py's FILTER_FIELDS)
// to a human-readable label, for summarizing an apply_filters action in
// the chat bubble instead of showing the raw payload.
const FILTER_FIELD_LABELS: Record<string, string> = {
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

function summarizeFilters(context: Record<string, unknown>): string {
  const parts = Object.entries(context)
    .filter(([, value]) => value !== "" && value !== null && value !== undefined)
    .filter(([, value]) => !(Array.isArray(value) && value.length === 0))
    .map(([key, value]) => {
      const label = FILTER_FIELD_LABELS[key] ?? key;
      const display = Array.isArray(value) ? value.join(", ") : String(value);
      return `${label}: ${display}`;
    });
  return parts.length > 0 ? `Applied filters — ${parts.join(", ")}` : "Cleared all filters";
}

function ReasoningLog({ steps }: { steps: ReasoningStep[] }) {
  const [open, setOpen] = useState(false);
  if (!steps || steps.length === 0) return null;

  return (
    <div className="reasoning">
      <button className="reasoning-toggle" onClick={() => setOpen((v) => !v)}>
        Reasoning
      </button>
      {open && (
        <div className="reasoning-log">
          {steps.map((step, i) => (
            <div key={i} className="reasoning-step">
              <div className="reasoning-tool">
                Called <code>{step.tool}</code>
              </div>
              <pre className="reasoning-args">{JSON.stringify(step.args, null, 2)}</pre>
              <div className="reasoning-result-label">Result</div>
              <pre className="reasoning-result">
                {step.result && step.result.length > 1500
                  ? step.result.slice(0, 1500) + "…"
                  : step.result}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // tool_call_id -> {name, args}, so result events (which carry no name,
  // only id) can be matched back to the call that produced them.
  const toolCallById = useRef(new Map<string, { name: string; args: Record<string, unknown> }>());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  async function sendMessage(overrideText?: string, displayText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;

    setMessages((prev) => [...prev, makeMessage("user", displayText ?? text)]);
    setInput("");
    setLoading(true);

    const assistantMessage = makeMessage("assistant", "");
    setMessages((prev) => [...prev, assistantMessage]);

    function updateAssistant(updater: (m: ChatMessage) => ChatMessage) {
      setMessages((prev) => prev.map((m) => (m.id === assistantMessage.id ? updater(m) : m)));
    }

    aguiAgent.messages.push({
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    });

    const subscriber: AgentSubscriber = {
      onTextMessageContentEvent({ textMessageBuffer }) {
        updateAssistant((m) => ({ ...m, content: stripLeakedComponentJson(textMessageBuffer) }));
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
        updateAssistant((m) => ({
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
      // The dashboard is built deterministically server-side and synced
      // via AG-UI's standard state mechanism (no tool call needed) - by
      // the time runAgent resolves, agent.state reflects this turn's
      // final graph state.
      const dashboard = (aguiAgent.state as { dashboard?: DashboardData | null })?.dashboard;
      if (dashboard) {
        updateAssistant((m) => ({ ...m, dashboard }));
      }
    } catch (err) {
      updateAssistant((m) => ({ ...m, content: `Error: ${(err as Error).message}` }));
    } finally {
      setLoading(false);
    }
  }

  function handleApplyFilters(values: Record<string, unknown>) {
    void sendMessage(`[UI_ACTION apply_filters] ${JSON.stringify(values)}`, summarizeFilters(values));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const hasMessages = messages.length > 0;

  const inputBar = (
    <div className="chat-input">
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="e.g. Show me internet-facing critical vulnerabilities for application APP123"
        rows={1}
        autoFocus
      />
      <button onClick={() => sendMessage()} disabled={loading || !input.trim()}>
        Send
      </button>
    </div>
  );

  return (
    <div className="chat-app">
      <header className="chat-header">
        One Search Vulnerability Assistant <span className="agui-badge">AG-UI</span>
      </header>

      {!hasMessages ? (
        <div className="landing">
          <h1>Ask about vulnerabilities</h1>
          <div className="landing-input">{inputBar}</div>
        </div>
      ) : (
        <>
          <div className="chat-window">
            {messages.map((m) => (
              <div key={m.id} className={`message-row ${m.role}`}>
                {m.role === "user" ? (
                  <div className="bubble user">{m.content}</div>
                ) : (
                  <div className="assistant-card">
                    <div className="assistant-text">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {m.content || (loading ? "" : "…")}
                      </ReactMarkdown>
                    </div>
                    {m.dashboard && (
                      <Dashboard data={m.dashboard} onApplyFilters={handleApplyFilters} />
                    )}
                    <ReasoningLog steps={m.reasoning} />
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="message-row assistant">
                <div className="typing-indicator">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="chat-input-bar">{inputBar}</div>
        </>
      )}
    </div>
  );
}
