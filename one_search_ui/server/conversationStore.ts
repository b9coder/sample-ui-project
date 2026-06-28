import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Conversation {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// A flat JSON file is enough here - this is conversation METADATA only
// (id/name/timestamps for the sidebar list), not message content. Each
// conversation's actual chat transcript lives client-side (see
// src/conversations/storage.ts) and the AG-UI thread's own state lives
// in the Python agent's checkpointer - this store exists purely so the
// left nav has something to list/rename/delete.
const DATA_FILE = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "conversations.json"
);

function load(): Conversation[] {
  if (!existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function save(conversations: Conversation[]): void {
  writeFileSync(DATA_FILE, JSON.stringify(conversations, null, 2));
}

export function listConversations(): Conversation[] {
  return load().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function createConversation(name?: string): Conversation {
  const conversations = load();
  const now = new Date().toISOString();
  const conversation: Conversation = {
    id: randomUUID(),
    name: name?.trim() || "New conversation",
    createdAt: now,
    updatedAt: now,
  };
  conversations.push(conversation);
  save(conversations);
  return conversation;
}

export function renameConversation(id: string, name: string): Conversation | null {
  const conversations = load();
  const conversation = conversations.find((c) => c.id === id);
  if (!conversation) return null;
  conversation.name = name.trim() || conversation.name;
  conversation.updatedAt = new Date().toISOString();
  save(conversations);
  return conversation;
}

export function touchConversation(id: string): void {
  const conversations = load();
  const conversation = conversations.find((c) => c.id === id);
  if (!conversation) return;
  conversation.updatedAt = new Date().toISOString();
  save(conversations);
}

export function deleteConversation(id: string): boolean {
  const conversations = load();
  const next = conversations.filter((c) => c.id !== id);
  if (next.length === conversations.length) return false;
  save(next);
  return true;
}
