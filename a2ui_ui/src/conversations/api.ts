// Thin client for the Node conversations API (server/conversationsPlugin.ts).
export interface Conversation {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

const BASE = "/api/conversations";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function listConversations(): Promise<Conversation[]> {
  return request<Conversation[]>("");
}

export function createConversation(name?: string): Promise<Conversation> {
  return request<Conversation>("", { method: "POST", body: JSON.stringify({ name }) });
}

export function renameConversation(id: string, name: string): Promise<Conversation> {
  return request<Conversation>(`/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

export function deleteConversation(id: string): Promise<void> {
  return request<void>(`/${id}`, { method: "DELETE" });
}

export function touchConversation(id: string): Promise<void> {
  return request<void>(`/${id}/touch`, { method: "POST" });
}
