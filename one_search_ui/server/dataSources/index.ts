import { resourceConfig } from "./config.ts";
import { sqliteApplications, sqliteConversations, sqliteUsers } from "./sqlite.ts";
import { createPostgresApplications, createPostgresConversations, createPostgresUsers } from "./postgres.ts";
import { createSqlServerApplications, createSqlServerConversations, createSqlServerUsers } from "./sqlserver.ts";
import { createStarburstApplications, createStarburstConversations, createStarburstUsers } from "./starburst.ts";
import type { ApplicationsSource, ConversationsSource, UsersSource } from "./types.ts";

let applicationsSource: ApplicationsSource | null = null;
let usersSource: UsersSource | null = null;
let conversationsSource: ConversationsSource | null = null;

/**
 * Each resource (conversations/applications/users) independently picks
 * its backend at the time it's first needed - via <RESOURCE>_BACKEND
 * env vars (config.ts) - so e.g. conversations can live in Postgres
 * while applications live in SQL Server and users in Starburst, all
 * at once. Defaults to sqlite (zero config) for every resource.
 */
export function getApplicationsSource(): ApplicationsSource {
  if (!applicationsSource) {
    const config = resourceConfig("APPLICATIONS");
    switch (config.backend) {
      case "postgres":
        applicationsSource = createPostgresApplications(config.pg);
        break;
      case "sqlserver":
        applicationsSource = createSqlServerApplications(config.mssql);
        break;
      case "starburst":
        applicationsSource = createStarburstApplications(config.starburst);
        break;
      default:
        applicationsSource = sqliteApplications;
    }
  }
  return applicationsSource;
}

export function getUsersSource(): UsersSource {
  if (!usersSource) {
    const config = resourceConfig("USERS");
    switch (config.backend) {
      case "postgres":
        usersSource = createPostgresUsers(config.pg);
        break;
      case "sqlserver":
        usersSource = createSqlServerUsers(config.mssql);
        break;
      case "starburst":
        usersSource = createStarburstUsers(config.starburst);
        break;
      default:
        usersSource = sqliteUsers;
    }
  }
  return usersSource;
}

export function getConversationsSource(): ConversationsSource {
  if (!conversationsSource) {
    const config = resourceConfig("CONVERSATIONS");
    switch (config.backend) {
      case "postgres":
        conversationsSource = createPostgresConversations(config.pg);
        break;
      case "sqlserver":
        conversationsSource = createSqlServerConversations(config.mssql);
        break;
      case "starburst":
        conversationsSource = createStarburstConversations(config.starburst);
        break;
      default:
        conversationsSource = sqliteConversations;
    }
  }
  return conversationsSource;
}
