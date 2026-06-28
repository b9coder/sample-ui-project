import * as applicationsAndUsers from "../entityStore.ts";
import * as conversations from "../conversationStore.ts";
import type { ApplicationsSource, ConversationsSource, UsersSource } from "./types.ts";

// Thin wrappers around the existing entityStore.ts/conversationStore.ts
// implementations (node:sqlite / flat JSON file respectively) so they
// conform to the same interfaces the Postgres/SQL Server/Starburst
// adapters implement - this is the default for every resource and
// needs zero configuration, matching local dev/testing.
export const sqliteApplications: ApplicationsSource = {
  listApplications: () => Promise.resolve(applicationsAndUsers.listApplications()),
};

export const sqliteUsers: UsersSource = {
  listUsers: () => Promise.resolve(applicationsAndUsers.listUsers()),
};

export const sqliteConversations: ConversationsSource = {
  list: () => Promise.resolve(conversations.listConversations()),
  create: (name?: string) => Promise.resolve(conversations.createConversation(name)),
  rename: (id: string, name: string) => Promise.resolve(conversations.renameConversation(id, name)),
  touch: (id: string) => Promise.resolve(conversations.touchConversation(id)),
  delete: (id: string) => Promise.resolve(conversations.deleteConversation(id)),
};
