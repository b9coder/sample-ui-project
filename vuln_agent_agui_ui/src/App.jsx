import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { A2uiSurface } from "@a2ui/react/v0_9";
import { aguiAgent } from "./agent";
import { a2uiProcessor, setA2uiActionListener } from "./a2ui";
import "./App.css";

const AGUI_BASE_URL = (import.meta.env.VITE_AGUI_URL || "http://localhost:8002/agui").replace(
  /\/agui$/,
  ""
);

// One message in our local chat transcript. `surfaces` holds any A2UI
// SurfaceModel objects rendered as part of this turn (kept as object
// refs so React re-renders when the surface's own internal signals
// change - A2uiSurface subscribes to those itself). `reasoning` holds
// the tool calls made during this turn, for the "Reasoning" toggle.
function makeMessage(role, content) {
  return { id: crypto.randomUUID(), role, content, surfaces: [], reasoning: [] };
}

function ReasoningLog({ steps }) {
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

function FilterBar({ applications, users, onFilter }) {
  const [appId, setAppId] = useState("");
  const [username, setUsername] = useState("");

  function apply(nextAppId, nextUsername) {
    const parts = [];
    const app = applications.find((a) => a.application_id === nextAppId);
    const user = users.find((u) => u.username === nextUsername);
    if (app) parts.push(`application ${app.application_name} (${app.application_id})`);
    if (user) parts.push(`owner ${user.full_name} (${user.email})`);
    if (parts.length === 0) return;
    onFilter(`Show me vulnerabilities for ${parts.join(" and ")}`);
  }

  return (
    <div className="filter-bar">
      <label className="filter-field">
        <span>Application</span>
        <select
          value={appId}
          onChange={(e) => {
            setAppId(e.target.value);
            apply(e.target.value, username);
          }}
        >
          <option value="">Any application</option>
          {applications.map((a) => (
            <option key={a.application_id} value={a.application_id}>
              {a.application_name} ({a.application_id})
            </option>
          ))}
        </select>
      </label>
      <label className="filter-field">
        <span>User</span>
        <select
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            apply(appId, e.target.value);
          }}
        >
          <option value="">Any user</option>
          {users.map((u) => (
            <option key={u.username} value={u.username}>
              {u.full_name} ({u.username})
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [applications, setApplications] = useState([]);
  const [users, setUsers] = useState([]);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  // tool_call_id -> {name, args}, so result events (which carry no name,
  // only id) can be matched back to the call that produced them - used
  // both for recognizing generate_a2ui results and for the reasoning log.
  const toolCallById = useRef(new Map());

  useEffect(() => {
    fetch(`${AGUI_BASE_URL}/applications`)
      .then((r) => r.json())
      .then((d) => setApplications(d.applications || []))
      .catch(() => {});
    fetch(`${AGUI_BASE_URL}/users`)
      .then((r) => r.json())
      .then((d) => setUsers(d.users || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // When the user clicks a Button (etc.) inside a rendered A2UI surface,
  // feed their selection back to the agent as a normal chat message.
  const handleA2uiAction = useCallback((action) => {
    const summary =
      action?.context && Object.keys(action.context).length > 0
        ? `${action.actionName || "select"}: ${JSON.stringify(action.context)}`
        : action?.actionName || "select";
    sendMessage(summary);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setA2uiActionListener(handleA2uiAction);
  }, [handleA2uiAction]);

  async function sendMessage(overrideText) {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;

    setMessages((prev) => [...prev, makeMessage("user", text)]);
    setInput("");
    setLoading(true);

    const assistantMessage = makeMessage("assistant", "");
    setMessages((prev) => [...prev, assistantMessage]);

    function updateAssistant(updater) {
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMessage.id ? updater(m) : m))
      );
    }

    aguiAgent.messages.push({
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    });

    try {
      await aguiAgent.runAgent(
        {},
        {
          onTextMessageContentEvent({ textMessageBuffer }) {
            updateAssistant((m) => ({ ...m, content: textMessageBuffer }));
          },
          onToolCallStartEvent({ event }) {
            toolCallById.current.set(event.toolCallId, {
              name: event.toolCallName,
              args: {},
            });
          },
          onToolCallEndEvent({ event, toolCallArgs }) {
            const entry = toolCallById.current.get(event.toolCallId);
            if (entry) entry.args = toolCallArgs;
          },
          onToolCallResultEvent({ event }) {
            const entry = toolCallById.current.get(event.toolCallId);
            const toolName = entry?.name;

            // Record every tool call (not just generate_a2ui) for the
            // Reasoning log.
            updateAssistant((m) => ({
              ...m,
              reasoning: [
                ...m.reasoning,
                { tool: toolName || "unknown", args: entry?.args || {}, result: event.content },
              ],
            }));

            if (toolName !== "generate_a2ui") return;
            try {
              const parsed = JSON.parse(event.content);
              if (parsed?.a2ui_operations) {
                a2uiProcessor.processMessages(parsed.a2ui_operations);
                const created = parsed.a2ui_operations
                  .map((op) => op.createSurface?.surfaceId)
                  .filter(Boolean);
                if (created.length > 0) {
                  updateAssistant((m) => ({
                    ...m,
                    surfaces: [...new Set([...m.surfaces, ...created])],
                  }));
                }
              }
            } catch {
              // Not JSON, or not an A2UI envelope - ignore.
            }
          },
        }
      );
    } catch (err) {
      updateAssistant((m) => ({ ...m, content: `Error: ${err.message}` }));
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
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
        placeholder="Ask anything"
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
        Vulnerability Assistant <span className="agui-badge">AG-UI + A2UI</span>
      </header>

      <FilterBar applications={applications} users={users} onFilter={sendMessage} />

      {!hasMessages ? (
        <div className="landing">
          <h1>What would you like to know?</h1>
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
                    {m.surfaces.map((surfaceId) => {
                      const surface = a2uiProcessor.model.getSurface?.(surfaceId);
                      if (!surface) return null;
                      return (
                        <div key={surfaceId} className="a2ui-surface-wrap">
                          <A2uiSurface surface={surface} />
                        </div>
                      );
                    })}
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
