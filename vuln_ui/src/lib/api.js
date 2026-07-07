const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8001";

export async function sendChat({ message, history = [], filters = null }) {
  const res = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, filters }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Agent error ${res.status}: ${detail}`);
  }
  return res.json(); // DisplayPayload {message, rows, meta}
}
