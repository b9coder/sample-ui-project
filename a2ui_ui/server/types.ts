// Conversation METADATA only (id/name/timestamps for the sidebar list) -
// NOT message content. Each conversation's transcript lives client-side
// (src/conversations/storage.ts) and the agent's per-thread state lives
// in the Python checkpointer; this store just backs the left-nav list.
export type Backend = "sqlite" | "postgres";

export interface Conversation {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationsSource {
  list(): Promise<Conversation[]>;
  create(name?: string): Promise<Conversation>;
  rename(id: string, name: string): Promise<Conversation | null>;
  touch(id: string): Promise<void>;
  delete(id: string): Promise<boolean>;
}
