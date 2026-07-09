import { Pool } from "pg";
import type { PgConnectionConfig } from "./config.ts";
import type { Conversation, ConversationsSource } from "./types.ts";

// Production backend. Expects a table like:
//
//   CREATE TABLE conversations (
//     id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//     name       TEXT NOT NULL,
//     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
//     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
//   );
//
// If the real column names differ, edit COLUMN_MAP (right-hand values);
// the rest of the app reads/writes by the left-hand keys.
const COLUMN_MAP = {
  id: "id",
  name: "name",
  created_at: "created_at",
  updated_at: "updated_at",
};

let pool: Pool | null = null;

function getPool(config: PgConnectionConfig): Pool {
  if (!pool) {
    pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

function selectColumns(): string {
  return Object.entries(COLUMN_MAP)
    .map(([alias, real]) => `${real} AS ${alias}`)
    .join(", ");
}

function rowToConversation(row: Record<string, unknown>): Conversation {
  return {
    id: String(row.id),
    name: String(row.name),
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

export function createPostgresConversations(config: PgConnectionConfig): ConversationsSource {
  const c = COLUMN_MAP;
  const table = config.table;

  return {
    async list(): Promise<Conversation[]> {
      const result = await getPool(config).query(
        `SELECT ${selectColumns()} FROM ${table} ORDER BY ${c.updated_at} DESC`
      );
      return result.rows.map(rowToConversation);
    },

    async create(name?: string): Promise<Conversation> {
      const result = await getPool(config).query(
        `INSERT INTO ${table} (${c.name}) VALUES ($1) RETURNING ${selectColumns()}`,
        [name?.trim() || "New conversation"]
      );
      return rowToConversation(result.rows[0]);
    },

    async rename(id: string, name: string): Promise<Conversation | null> {
      const result = await getPool(config).query(
        `UPDATE ${table} SET ${c.name} = $1, ${c.updated_at} = now()
         WHERE ${c.id} = $2 RETURNING ${selectColumns()}`,
        [name.trim(), id]
      );
      return result.rows[0] ? rowToConversation(result.rows[0]) : null;
    },

    async touch(id: string): Promise<void> {
      await getPool(config).query(
        `UPDATE ${table} SET ${c.updated_at} = now() WHERE ${c.id} = $1`,
        [id]
      );
    },

    async delete(id: string): Promise<boolean> {
      const result = await getPool(config).query(
        `DELETE FROM ${table} WHERE ${c.id} = $1`,
        [id]
      );
      return (result.rowCount ?? 0) > 0;
    },
  };
}
