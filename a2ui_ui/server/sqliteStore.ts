import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Conversation, ConversationsSource } from "./types.ts";

// Local-dev backend: a self-contained SQLite file (node:sqlite, Node
// 22+). Same table shape as the Postgres production adapter, so moving
// to Postgres is just a config switch + running the DDL in postgresStore.
const DB_PATH = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "conversations.db"
);

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }
  return db;
}

function rowToConversation(row: Record<string, unknown>): Conversation {
  return {
    id: String(row.id),
    name: String(row.name),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export const sqliteConversations: ConversationsSource = {
  async list(): Promise<Conversation[]> {
    const rows = getDb()
      .prepare("SELECT * FROM conversations ORDER BY updated_at DESC")
      .all() as Record<string, unknown>[];
    return rows.map(rowToConversation);
  },

  async create(name?: string): Promise<Conversation> {
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: randomUUID(),
      name: name?.trim() || "New conversation",
      createdAt: now,
      updatedAt: now,
    };
    getDb()
      .prepare(
        "INSERT INTO conversations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)"
      )
      .run(conversation.id, conversation.name, conversation.createdAt, conversation.updatedAt);
    return conversation;
  },

  async rename(id: string, name: string): Promise<Conversation | null> {
    const now = new Date().toISOString();
    const result = getDb()
      .prepare("UPDATE conversations SET name = ?, updated_at = ? WHERE id = ?")
      .run(name.trim(), now, id);
    if (result.changes === 0) return null;
    const row = getDb()
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(id) as Record<string, unknown>;
    return rowToConversation(row);
  },

  async touch(id: string): Promise<void> {
    getDb()
      .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  },

  async delete(id: string): Promise<boolean> {
    const result = getDb().prepare("DELETE FROM conversations WHERE id = ?").run(id);
    return result.changes > 0;
  },
};
