import type { ChatMessage } from "../types";

// Per-conversation transcripts live in localStorage, keyed by
// conversation id - the Node conversations API only tracks metadata
// (id/name/timestamps) for the sidebar list, and the Python agent's
// LangGraph checkpointer is in-memory/ephemeral, so this is what makes
// switching back to an older conversation actually show its history.
const KEY_PREFIX = "one_search_messages_";

export function loadMessages(conversationId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + conversationId);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveMessages(conversationId: string, messages: ChatMessage[]): void {
  try {
    localStorage.setItem(KEY_PREFIX + conversationId, JSON.stringify(messages));
  } catch {
    // localStorage full/unavailable - not fatal, just won't persist.
  }
}

export function clearMessages(conversationId: string): void {
  localStorage.removeItem(KEY_PREFIX + conversationId);
}
