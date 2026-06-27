import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Sidebar from "./Sidebar";
import Chart from "./Chart";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import "./App.css";

const AGENT_URL = import.meta.env.VITE_AGENT_URL || "http://localhost:8001";
const MAX_TEXTAREA_HEIGHT = 200;
const STORAGE_KEY = "vuln_chat_conversations";

function makeConversation() {
  return {
    id: crypto.randomUUID(),
    threadId: crypto.randomUUID(),
    title: "New conversation",
    messages: [],
  };
}

function loadConversations() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.conversations) && parsed.conversations.length > 0) {
      return parsed;
    }
  } catch {
    // fall through to default
  }
  return null;
}

function IconButton({ title, active, onClick, children }) {
  return (
    <button
      className={`icon-btn ${active ? "active" : ""}`}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ThumbsUpIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
      <path
        d="M7 10v10H4V10h3zm0 0l4.5-6a1.5 1.5 0 0 1 2.7 1l-.9 5h5a2 2 0 0 1 2 2.4l-1.4 6A2 2 0 0 1 17 20H7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ThumbsDownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" style={{ transform: "rotate(180deg)" }}>
      <path
        d="M7 10v10H4V10h3zm0 0l4.5-6a1.5 1.5 0 0 1 2.7 1l-.9 5h5a2 2 0 0 1 2 2.4l-1.4 6A2 2 0 0 1 17 20H7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
      <path d="M12 16V4M12 4l-4 4M12 4l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RegenerateIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
      <path
        d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 4v4h-4M6 20v-4h4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MessageActions({ message, onFeedback, onRegenerate }) {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  return (
    <div className="message-actions">
      <IconButton
        title="Copy"
        onClick={async () => {
          await navigator.clipboard.writeText(message.content);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </IconButton>
      <IconButton
        title="Good response"
        active={message.feedback === "up"}
        onClick={() => onFeedback(message.feedback === "up" ? null : "up")}
      >
        <ThumbsUpIcon />
      </IconButton>
      <IconButton
        title="Bad response"
        active={message.feedback === "down"}
        onClick={() => onFeedback(message.feedback === "down" ? null : "down")}
      >
        <ThumbsDownIcon />
      </IconButton>
      <IconButton
        title="Share"
        onClick={async () => {
          await navigator.clipboard.writeText(message.content);
          setShared(true);
          setTimeout(() => setShared(false), 1200);
        }}
      >
        {shared ? <CheckIcon /> : <ShareIcon />}
      </IconButton>
      <IconButton title="Regenerate" onClick={onRegenerate}>
        <RegenerateIcon />
      </IconButton>
    </div>
  );
}

function TrustedBadge() {
  return (
    <Badge
      variant="outline"
      className="trusted-badge"
      title="Backed by an exact database extract for this exact criteria"
    >
      ✓ Trusted
    </Badge>
  );
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
        <Card className="reasoning-log">
          <CardContent className="reasoning-log-content">
            {steps.map((step, i) => (
              <div key={i} className="reasoning-step">
                <div className="reasoning-tool">
                  Called <code>{step.tool}</code>
                </div>
                <pre className="reasoning-args">
                  {JSON.stringify(step.args, null, 2)}
                </pre>
                <div className="reasoning-result-label">Result</div>
                <pre className="reasoning-result">{step.result}</pre>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function App() {
  const [state, setState] = useState(() => {
    const loaded = loadConversations();
    if (loaded) return loaded;
    const first = makeConversation();
    return { conversations: [first], activeId: first.id };
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  const { conversations, activeId } = state;
  const active = conversations.find((c) => c.id === activeId) ?? conversations[0];
  const messages = active.messages;
  const hasMessages = messages.length > 0;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [input]);

  function updateActiveConversation(updater) {
    setState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) =>
        c.id === prev.activeId ? updater(c) : c
      ),
    }));
  }

  function handleNewChat() {
    const fresh = makeConversation();
    setState((prev) => ({
      conversations: [fresh, ...prev.conversations],
      activeId: fresh.id,
    }));
    setInput("");
  }

  function handleSelect(id) {
    setState((prev) => ({ ...prev, activeId: id }));
    setInput("");
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const isFirstMessage = messages.length === 0;
    const threadId = active.threadId;

    updateActiveConversation((c) => ({
      ...c,
      title: isFirstMessage ? text.slice(0, 48) : c.title,
      messages: [...c.messages, { role: "user", content: text }],
    }));
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${AGENT_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, thread_id: threadId }),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data = await res.json();
      updateActiveConversation((c) => ({
        ...c,
        messages: [
          ...c.messages,
          {
            role: "assistant",
            content: data.reply,
            reasoning: data.reasoning,
            trusted: data.trusted,
            chart: data.chart,
          },
        ],
      }));
    } catch (err) {
      updateActiveConversation((c) => ({
        ...c,
        messages: [...c.messages, { role: "error", content: `Error: ${err.message}` }],
      }));
    } finally {
      setLoading(false);
    }
  }

  function setFeedback(index, value) {
    updateActiveConversation((c) => ({
      ...c,
      messages: c.messages.map((m, i) => (i === index ? { ...m, feedback: value } : m)),
    }));
  }

  async function regenerate(index) {
    if (loading) return;
    const precedingUser = [...messages.slice(0, index)]
      .reverse()
      .find((m) => m.role === "user");
    if (!precedingUser) return;

    setLoading(true);
    try {
      const res = await fetch(`${AGENT_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: precedingUser.content, thread_id: active.threadId }),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data = await res.json();
      updateActiveConversation((c) => ({
        ...c,
        messages: c.messages.map((m, i) =>
          i === index
            ? {
                role: "assistant",
                content: data.reply,
                reasoning: data.reasoning,
                trusted: data.trusted,
                chart: data.chart,
              }
            : m
        ),
      }));
    } catch (err) {
      updateActiveConversation((c) => ({
        ...c,
        messages: c.messages.map((m, i) =>
          i === index ? { role: "error", content: `Error: ${err.message}` } : m
        ),
      }));
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

  const inputBar = (
    <div className="chat-input">
      <button className="plus-btn" aria-label="Add" tabIndex={-1}>
        +
      </button>
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything"
        rows={1}
        autoFocus
      />
      <button
        className="send-btn"
        onClick={sendMessage}
        disabled={loading || !input.trim()}
        aria-label="Send"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
          <path
            d="M12 19V5M12 5L5 12M12 5L19 12"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );

  return (
    <div className="app-shell">
      <Sidebar
        conversations={conversations}
        activeId={active.id}
        onSelect={handleSelect}
        onNewChat={handleNewChat}
      />

      <div className="chat-app">
        <header className="chat-header">
          Vulnerability Assistant <span className="chevron">⌄</span>
        </header>

        {!hasMessages ? (
          <div className="landing">
            <h1>What would you like to know?</h1>
            <div className="landing-input">{inputBar}</div>
          </div>
        ) : (
          <>
            <div className="chat-window">
              {messages.map((m, i) => (
                <div key={i} className={`message-row ${m.role}`}>
                  {m.role === "user" ? (
                    <div className="bubble user">{m.content}</div>
                  ) : (
                    <Card className={`assistant-card ${m.role === "error" ? "error" : ""}`}>
                      {m.trusted && (
                        <div className="trusted-row">
                          <TrustedBadge />
                        </div>
                      )}
                      <CardContent className="assistant-text">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: (props) => (
                              <a {...props} target="_blank" rel="noopener noreferrer" />
                            ),
                          }}
                        >
                          {m.content}
                        </ReactMarkdown>
                        {m.role === "assistant" && m.chart && <Chart spec={m.chart} />}
                        {m.role === "assistant" && (
                          <MessageActions
                            message={m}
                            onFeedback={(value) => setFeedback(i, value)}
                            onRegenerate={() => regenerate(i)}
                          />
                        )}
                        {m.role === "assistant" && <ReasoningLog steps={m.reasoning} />}
                      </CardContent>
                    </Card>
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
    </div>
  );
}
