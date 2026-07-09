import type { Backend } from "./types.ts";

// The conversations store backend: "sqlite" (default, zero-config local
// dev - a file DB via node:sqlite) or "postgres" (production). Selected
// by CONVERSATIONS_BACKEND; Postgres connection via CONVERSATIONS_PG_*.
export interface PgConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  table: string;
  ssl: boolean;
}

export interface ConversationsConfig {
  backend: Backend;
  pg: PgConnectionConfig;
}

function env(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  return raw ? parseInt(raw, 10) : fallback;
}

export function conversationsConfig(): ConversationsConfig {
  return {
    backend: env("CONVERSATIONS_BACKEND", "sqlite") as Backend,
    pg: {
      host: env("CONVERSATIONS_PG_HOST", "localhost"),
      port: envInt("CONVERSATIONS_PG_PORT", 5432),
      database: env("CONVERSATIONS_PG_DATABASE", ""),
      user: env("CONVERSATIONS_PG_USER", ""),
      password: env("CONVERSATIONS_PG_PASSWORD", ""),
      table: env("CONVERSATIONS_PG_TABLE", "conversations"),
      ssl: env("CONVERSATIONS_PG_SSL", "false").toLowerCase() === "true",
    },
  };
}
