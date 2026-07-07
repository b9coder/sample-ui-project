import { useRef, useState, useEffect } from "react";
import { SendHorizonal, ShieldAlert, Loader2 } from "lucide-react";
import { runVulnAgent } from "./lib/agui.js";
import RowRenderer from "./components/rows/RowRenderer.jsx";
import { Button } from "./components/ui/primitives.jsx";

const SUGGESTIONS = [
  "Give me a summary of all critical vulnerabilities",
  "Which applications are the riskiest?",
  "Show the remediation trend for the last 6 months",
  "Show me past-due internet-facing records",
];

export default function App() {
  const [messages, setMessages] = useState([]); // {role, content, rows?, meta?}
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const [streaming, setStreaming] = useState("");

  async function submit(text, filters = null) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setStreaming("");
    try {
      // History is tracked by the AG-UI HttpAgent (threaded conversation).
      const payload = await runVulnAgent(text, filters, setStreaming);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: payload.message, rows: payload.rows, meta: payload.meta },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Something went wrong: ${err.message}` },
      ]);
    } finally {
      setBusy(false);
      setStreaming("");
    }
  }

  const applyFilters = (filters) =>
    submit("Re-run my last query with the filters I selected in the filter panel.", filters);

  return (
    <div className="mx-auto flex h-screen max-w-5xl flex-col px-4">
      <header className="flex items-center gap-2 border-b border-border py-4">
        <ShieldAlert className="h-5 w-5" />
        <h1 className="text-base font-semibold">Vulnerability Agent</h1>
      </header>

      <main className="flex-1 space-y-6 overflow-y-auto py-6">
        {!messages.length && (
          <div className="mt-16 text-center">
            <p className="mb-4 text-sm text-muted-foreground">Ask about your vulnerability data</p>
            <div className="mx-auto flex max-w-xl flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <Button key={s} variant="outline" onClick={() => submit(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[75%] rounded-2xl bg-primary px-4 py-2 text-sm text-primary-foreground">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="space-y-3">
              {m.rows ? (
                <RowRenderer rows={m.rows} onApplyFilters={applyFilters} />
              ) : (
                <p className="text-sm">{m.content}</p>
              )}
              {m.meta && (
                <p className="text-[11px] text-muted-foreground">
                  layout: {m.meta.source} · tools: {(m.meta.tools_used || []).join(", ") || "none"}
                </p>
              )}
            </div>
          )
        )}

        {busy && (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
            <span>{streaming || "Working…"}</span>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      <footer className="border-t border-border py-3">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. How many critical vulnerabilities are past due?"
            className="flex-1 rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          />
          <Button type="submit" disabled={busy || !input.trim()}>
            <SendHorizonal className="h-4 w-4" />
          </Button>
        </form>
      </footer>
    </div>
  );
}
