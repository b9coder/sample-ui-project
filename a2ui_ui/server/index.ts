import { conversationsConfig } from "./config.ts";
import { sqliteConversations } from "./sqliteStore.ts";
import { createPostgresConversations } from "./postgresStore.ts";
import type { ConversationsSource } from "./types.ts";

let source: ConversationsSource | null = null;

// Picks the conversations backend once, at first use: "postgres" for
// production (CONVERSATIONS_BACKEND=postgres + CONVERSATIONS_PG_*), else
// the zero-config local SQLite file.
export function getConversationsSource(): ConversationsSource {
  if (!source) {
    const config = conversationsConfig();
    source =
      config.backend === "postgres"
        ? createPostgresConversations(config.pg)
        : sqliteConversations;
  }
  return source;
}
