import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentSubscriber } from "@ag-ui/client";
import { aguiAgent } from "./agent";
import { A2UISurface } from "./a2ui/A2UISurface";
import { ApplyFiltersContext } from "./a2ui/ApplyFiltersContext";
import { SuggestedQuestions } from "./SuggestedQuestions";
import { Sidebar } from "./conversations/Sidebar";
import * as conversationsApi from "./conversations/api";
import type { Conversation } from "./conversations/api";
import { loadMessages, saveMessages, clearMessages } from "./conversations/storage";
import { makeMessage, type ChatMessage, type ReasoningStep } from "./types";

const SESSION_START = "[UI_ACTION session_start]";
const DEFAULT_NAME = "New conversation";
const SIDEBAR_COLLAPSED_KEY = "a2ui_sidebar_collapsed";

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

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true"
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(null);
  // Conversations already greeted with session_start this app session,
  // so switching back and forth doesn't re-trigger the welcome.
  const greetedRef = useRef<Set<string>>(new Set());
  const toolCallById = useRef(new Map<string, { name: string; args: Record<string, unknown> }>());

  // Bootstrap: load the conversation list (create one if empty) and open
  // the most recently active one.
  useEffect(() => {
    conversationsApi.listConversations().then(async (list) => {
      let initial = list;
      if (initial.length === 0) initial = [await conversationsApi.createConversation()];
      setConversations(initial);
      const first = initial[0];
      activeIdRef.current = first.id;
      setActiveId(first.id);
      aguiAgent.threadId = first.id;
      setMessages(loadMessages(first.id));
    });
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (activeId) saveMessages(activeId, messages);
  }, [activeId, messages]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  // Greet on a freshly-opened, empty conversation (once per id).
  useEffect(() => {
    if (!activeId || loading) return;
    if (messages.length > 0) {
      greetedRef.current.add(activeId);
      return;
    }
    if (greetedRef.current.has(activeId)) return;
    greetedRef.current.add(activeId);
    void send(SESSION_START);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, messages.length, loading]);

  const switchConversation = useCallback((id: string) => {
    if (id === activeIdRef.current) return;
    activeIdRef.current = id;
    setActiveId(id);
    aguiAgent.threadId = id;
    aguiAgent.setMessages([]);
    setMessages(loadMessages(id));
  }, []);

  async function handleCreateConversation() {
    const created = await conversationsApi.createConversation();
    setConversations((prev) => [created, ...prev]);
    switchConversation(created.id);
  }

  async function handleRenameConversation(id: string, name: string) {
    const updated = await conversationsApi.renameConversation(id, name);
    setConversations((prev) => prev.map((c) => (c.id === id ? updated : c)));
  }

  async function handleDeleteConversation(id: string) {
    await conversationsApi.deleteConversation(id);
    clearMessages(id);
    const remaining = conversations.filter((c) => c.id !== id);
    if (id === activeIdRef.current) {
      if (remaining.length > 0) {
        switchConversation(remaining[0].id);
      } else {
        const created = await conversationsApi.createConversation();
        remaining.push(created);
        switchConversation(created.id);
      }
    }
    setConversations(remaining);
  }

  async function send(overrideText?: string, displayText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;
    const conversationId = activeIdRef.current;

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
            { tool: entry?.name || "unknown", args: entry?.args || {}, result: String(event.content) },
          ],
        }));
      },
    };

    try {
      await aguiAgent.runAgent({}, subscriber);
      const state = aguiAgent.state as {
        a2ui_messages?: unknown[] | null;
        suggestions?: string[] | null;
      };
      if (state?.a2ui_messages) update((m) => ({ ...m, a2uiMessages: state.a2ui_messages! }));
      if (state?.suggestions) update((m) => ({ ...m, suggestions: state.suggestions! }));
    } catch (err) {
      update((m) => ({ ...m, content: `Error: ${(err as Error).message}` }));
    } finally {
      setLoading(false);
    }

    // Name a fresh conversation after its first real message; otherwise
    // just bump its position in the list.
    if (conversationId && !isAction) {
      const conversation = conversations.find((c) => c.id === conversationId);
      if (conversation && conversation.name === DEFAULT_NAME) {
        void handleRenameConversation(conversationId, text.length > 60 ? text.slice(0, 60) + "…" : text);
      } else {
        void conversationsApi.touchConversation(conversationId).then(() => {
          setConversations((prev) =>
            prev.map((c) => (c.id === conversationId ? { ...c, updatedAt: new Date().toISOString() } : c))
          );
        });
      }
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const handleApplyFilters = useCallback((values: Record<string, unknown>) => {
    void send(`[UI_ACTION apply_filters] ${JSON.stringify(values)}`, summarizeFilters(values));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ApplyFiltersContext.Provider value={handleApplyFilters}>
      <div className="app-shell">
        <Sidebar
          conversations={conversations}
          activeId={activeId}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
          onSelect={switchConversation}
          onCreate={handleCreateConversation}
          onRename={handleRenameConversation}
          onDelete={handleDeleteConversation}
        />
        <div className="app">
          <header className="app-header">
            <span className="app-brand">A2UI Vulnerability Assistant</span>
            <span className="app-sub">UI generated by the agent · rendered with @a2ui/react</span>
          </header>

          <div className="chat">
            {messages.map((m, i) => (
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
                    <SuggestedQuestions
                      questions={m.suggestions}
                      onAsk={(q) => void send(q)}
                      disabled={loading}
                      label={i === 0 ? "Suggested starting points" : "Related questions"}
                    />
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
      </div>
    </ApplyFiltersContext.Provider>
  );
}
