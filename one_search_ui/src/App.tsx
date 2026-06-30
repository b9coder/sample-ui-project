import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentSubscriber } from "@ag-ui/client";
import { aguiAgent } from "./agent";
import { Dashboard } from "./dashboard/Dashboard";
import { Table } from "./dashboard/Table";
import type { Dashboard as DashboardData, TableSpec } from "./dashboard/types";
import { DeclarativeDashboard } from "./declarative/DeclarativeDashboard";
import type { UIData, UISpec } from "./declarative/types";
import { summarizeFilters } from "./dashboard/filterLabels";
import { makeMessage, type ChatMessage, type ReasoningStep } from "./types";
import { stripLeakedComponentJson } from "./sanitizeReply";
import { Sidebar } from "./conversations/Sidebar";
import * as conversationsApi from "./conversations/api";
import type { Conversation } from "./conversations/api";
import { loadMessages, saveMessages, clearMessages } from "./conversations/storage";
import "./App.css";

const RESULT_PREVIEW_LIMIT = 1500;
const SIDEBAR_COLLAPSED_KEY = "one_search_sidebar_collapsed";
const DEFAULT_NAME = "New conversation";
// "dashboard" (default) keeps the existing Dashboard.tsx rendering
// exactly as before - zero behavior change unless explicitly opted
// into the new declarative renderer via .env's VITE_UI_RENDER_MODE.
// The agent always computes/sends BOTH (see agent.py's
// _build_ui_data/_build_ui_spec docstring) - this only picks which
// one this frontend build renders.
const UI_RENDER_MODE = import.meta.env.VITE_UI_RENDER_MODE === "declarative" ? "declarative" : "dashboard";

function ReasoningStepView({ step }: { step: ReasoningStep }) {
  const isTruncatable = step.result && step.result.length > RESULT_PREVIEW_LIMIT;
  const [expanded, setExpanded] = useState(false);
  const shown =
    isTruncatable && !expanded ? step.result.slice(0, RESULT_PREVIEW_LIMIT) + "…" : step.result;

  return (
    <div className="reasoning-step">
      <div className="reasoning-tool">
        Called <code>{step.tool}</code>
      </div>
      <pre className="reasoning-args">{JSON.stringify(step.args, null, 2)}</pre>
      <div className="reasoning-result-label">Result</div>
      <pre className="reasoning-result">{shown}</pre>
      {isTruncatable && (
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
        Reasoning
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastRowRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);
  const activeIdRef = useRef<string | null>(null);
  // tool_call_id -> {name, args}, so result events (which carry no name,
  // only id) can be matched back to the call that produced them.
  const toolCallById = useRef(new Map<string, { name: string; args: Record<string, unknown> }>());

  // Bootstrap: load the conversation list, creating one if there are
  // none yet, and switch into the most recently active one.
  useEffect(() => {
    conversationsApi.listConversations().then(async (list) => {
      let initial = list;
      if (initial.length === 0) {
        const created = await conversationsApi.createConversation();
        initial = [created];
      }
      setConversations(initial);
      const first = initial[0];
      activeIdRef.current = first.id;
      setActiveId(first.id);
      aguiAgent.threadId = first.id;
      setMessages(loadMessages(first.id));
    });
  }, []);

  // Scroll the newest message's TOP into view once, when it's added -
  // not on every streamed token (messages updates on each one), which
  // would otherwise keep yanking the view down to chase the cursor.
  useEffect(() => {
    if (messages.length > prevCountRef.current) {
      lastRowRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    prevCountRef.current = messages.length;
  }, [messages.length]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // Persist this conversation's transcript whenever it changes - the
  // Node conversations API only tracks metadata, not message content.
  useEffect(() => {
    if (activeId) saveMessages(activeId, messages);
  }, [activeId, messages]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

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

  async function sendMessage(overrideText?: string, displayText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;
    const conversationId = activeIdRef.current;

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
      const state = aguiAgent.state as {
        dashboard?: DashboardData | null;
        records_table?: TableSpec | null;
        ui_spec?: UISpec | null;
        ui_data?: UIData | null;
      };
      if (state?.dashboard) {
        updateAssistant((m) => ({ ...m, dashboard: state.dashboard! }));
      }
      if (state?.records_table) {
        updateAssistant((m) => ({ ...m, recordsTable: state.records_table! }));
      }
      if (state?.ui_spec && state?.ui_data) {
        updateAssistant((m) => ({ ...m, uiSpec: state.ui_spec!, uiData: state.ui_data! }));
      }
    } catch (err) {
      updateAssistant((m) => ({ ...m, content: `Error: ${(err as Error).message}` }));
    } finally {
      setLoading(false);
    }

    if (conversationId) {
      const conversation = conversations.find((c) => c.id === conversationId);
      if (conversation && conversation.name === DEFAULT_NAME) {
        const autoName = text.length > 60 ? text.slice(0, 60) + "…" : text;
        void handleRenameConversation(conversationId, autoName);
      } else {
        void conversationsApi.touchConversation(conversationId).then(() => {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === conversationId ? { ...c, updatedAt: new Date().toISOString() } : c
            )
          );
        });
      }
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
      <div className="chat-app">
        <header className="chat-header">One Search Vulnerability Assistant</header>

        {!hasMessages ? (
          <div className="landing">
            <h1>Ask about vulnerabilities</h1>
            <div className="landing-input">{inputBar}</div>
          </div>
        ) : (
          <>
            <div className="chat-window">
              {messages.map((m, i) => (
                <div
                  key={m.id}
                  ref={i === messages.length - 1 ? lastRowRef : undefined}
                  className={`message-row ${m.role}`}
                >
                  {m.role === "user" ? (
                    <div className="bubble user">{m.content}</div>
                  ) : (
                    <div className="assistant-card">
                      <div className="assistant-text">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {m.content || (loading ? "" : "…")}
                        </ReactMarkdown>
                      </div>
                      {UI_RENDER_MODE === "declarative" ? (
                        m.uiSpec &&
                        m.uiData && (
                          <DeclarativeDashboard
                            spec={m.uiSpec}
                            data={m.uiData}
                            onApplyFilters={handleApplyFilters}
                          />
                        )
                      ) : (
                        <>
                          {m.dashboard && (
                            <Dashboard data={m.dashboard} onApplyFilters={handleApplyFilters} />
                          )}
                          {m.recordsTable && (
                            <div className="osa-records-panel">
                              <Table spec={m.recordsTable} />
                            </div>
                          )}
                        </>
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
            </div>

            <div className="chat-input-bar">{inputBar}</div>
          </>
        )}
      </div>
    </div>
  );
}
