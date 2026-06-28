import type { Backend } from "./types.ts";

export interface PgConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  table: string;
}

export interface MssqlConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  table: string;
}

export interface StarburstConnectionConfig {
  host: string;
  port: number;
  httpScheme: string;
  catalog: string;
  schema: string;
  user: string;
  password: string;
  table: string;
}

export interface ResourceConfig {
  backend: Backend;
  pg: PgConnectionConfig;
  mssql: MssqlConnectionConfig;
  starburst: StarburstConnectionConfig;
}

function env(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  return raw ? parseInt(raw, 10) : fallback;
}

/**
 * Each of conversations/applications/users is independently
 * configurable to live in a different backend - e.g. conversations in
 * Postgres, applications in SQL Server, users in Starburst - so every
 * setting is read under a resource-specific env var prefix
 * (CONVERSATIONS_*, APPLICATIONS_*, USERS_*). Defaults to "sqlite" for
 * every resource so local dev/testing needs zero configuration.
 */
export function resourceConfig(resource: "CONVERSATIONS" | "APPLICATIONS" | "USERS"): ResourceConfig {
  const backend = env(`${resource}_BACKEND`, "sqlite") as Backend;
  const defaultTable = resource.toLowerCase();

  return {
    backend,
    pg: {
      host: env(`${resource}_PG_HOST`, "localhost"),
      port: envInt(`${resource}_PG_PORT`, 5432),
      database: env(`${resource}_PG_DATABASE`, ""),
      user: env(`${resource}_PG_USER`, ""),
      password: env(`${resource}_PG_PASSWORD`, ""),
      table: env(`${resource}_PG_TABLE`, defaultTable), // TODO: confirm real table name
    },
    mssql: {
      host: env(`${resource}_MSSQL_HOST`, "localhost"),
      port: envInt(`${resource}_MSSQL_PORT`, 1433),
      database: env(`${resource}_MSSQL_DATABASE`, ""),
      user: env(`${resource}_MSSQL_USER`, ""),
      password: env(`${resource}_MSSQL_PASSWORD`, ""),
      table: env(`${resource}_MSSQL_TABLE`, defaultTable), // TODO: confirm real table name
    },
    starburst: {
      host: env(`${resource}_STARBURST_HOST`, "localhost"),
      port: envInt(`${resource}_STARBURST_PORT`, 443),
      httpScheme: env(`${resource}_STARBURST_HTTP_SCHEME`, "https"),
      catalog: env(`${resource}_STARBURST_CATALOG`, ""),
      schema: env(`${resource}_STARBURST_SCHEMA`, ""),
      user: env(`${resource}_STARBURST_USER`, ""),
      password: env(`${resource}_STARBURST_PASSWORD`, ""),
      table: env(`${resource}_STARBURST_TABLE`, defaultTable), // TODO: confirm real table name
    },
  };
}
