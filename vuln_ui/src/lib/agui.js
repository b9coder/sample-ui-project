// AG-UI transport: connects the React app to the agent's /agui endpoint
// via @ag-ui/client's HttpAgent. The agent instance keeps the message
// history across runs (threaded conversation).
//
// The backend emits a CUSTOM event named "display_rows" whose value is the
// DisplayPayload {message, rows, meta}; RUN_FINISHED carries it as `result`
// too, which we use as a fallback.
import { HttpAgent } from "@ag-ui/client";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8001";

export const vulnAgent = new HttpAgent({
  url: `${API_BASE}/agui`,
  threadId: crypto.randomUUID(),
});

/**
 * Run one turn. Returns the DisplayPayload {message, rows, meta}.
 * @param {string} message  user message
 * @param {object|null} filters  structured filters from the filter panel
 * @param {(text: string) => void} [onText]  streaming text callback
 */
export async function runVulnAgent(message, filters = null, onText) {
  vulnAgent.messages.push({
    id: crypto.randomUUID(),
    role: "user",
    content: message,
  });

  let payload = null;
  let streamedText = "";
  let runError = null;

  await vulnAgent.runAgent(
    { forwardedProps: filters ? { filters } : {} },
    {
      onTextMessageContentEvent: ({ textMessageBuffer }) => {
        streamedText = textMessageBuffer;
        onText?.(textMessageBuffer);
      },
      onCustomEvent: ({ event }) => {
        if (event.name === "display_rows") payload = event.value;
      },
      onRunFinishedEvent: ({ result }) => {
        if (!payload && result?.rows) payload = result;
      },
      onRunErrorEvent: ({ event }) => {
        runError = new Error(event.message || "Agent run failed");
      },
    }
  );

  if (runError) throw runError;
  if (!payload) {
    payload = {
      message: streamedText,
      rows: streamedText
        ? [{ items: [{ element: { type: "markdown", content: streamedText }, span: 0 }] }]
        : [],
      meta: { source: "text-only" },
    };
  }
  return payload;
}
