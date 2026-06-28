import { Trino, BasicAuth } from "trino-client";
import type { StarburstConnectionConfig } from "./config.ts";
import type {
  ApplicationRow,
  ApplicationsSource,
  Conversation,
  ConversationsSource,
  UserRow,
  UsersSource,
} from "./types.ts";

// *** PLACEHOLDER column names - edit COLUMN_MAP below to match the
// real Starburst catalog/schema before pointing a resource's
// *_BACKEND at "starburst". Only the right-hand strings need to
// change.
const APPLICATIONS_COLUMN_MAP = {
  application_id: "application_id", // TODO
  application_name: "application_name", // TODO
  business_unit: "business_unit", // TODO
  environment: "environment", // TODO
  owner_ecn: "owner_ecn", // TODO
  description: "description", // TODO
};

const USERS_COLUMN_MAP = {
  ecn: "ecn", // TODO
  first_name: "first_name", // TODO
  last_name: "last_name", // TODO
  email: "email", // TODO
  band: "band", // TODO
  department: "department", // TODO
  role: "role", // TODO
};

const CONVERSATIONS_COLUMN_MAP = {
  id: "id", // TODO
  name: "name", // TODO
  created_at: "created_at", // TODO
  updated_at: "updated_at", // TODO
};

const clients = new Map<string, Trino>();

function getClient(config: StarburstConnectionConfig): Trino {
  const key = `${config.host}:${config.port}/${config.catalog}/${config.schema}`;
  let client = clients.get(key);
  if (!client) {
    client = Trino.create({
      server: `${config.httpScheme}://${config.host}:${config.port}`,
      catalog: config.catalog,
      schema: config.schema,
      auth: new BasicAuth(config.user, config.password),
    });
    clients.set(key, client);
  }
  return client;
}

function selectColumns(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([alias, real]) => `${real} AS ${alias}`)
    .join(", ");
}

/** Runs a query to completion and returns rows as plain objects keyed
 * by column name (trino-client's QueryResult uses positional arrays
 * with separate column metadata, not row objects). */
async function runQuery(client: Trino, statement: string): Promise<Record<string, unknown>[]> {
  const iter = await client.query(statement);
  const rows: Record<string, unknown>[] = [];
  let columnNames: string[] | null = null;

  for await (const result of iter) {
    if (result.error) {
      throw new Error(result.error.message ?? "Trino query failed");
    }
    if (!columnNames && result.columns) {
      columnNames = result.columns.map((col) => col.name);
    }
    if (result.data && columnNames) {
      for (const row of result.data) {
        const obj: Record<string, unknown> = {};
        columnNames.forEach((name, i) => {
          obj[name] = row[i];
        });
        rows.push(obj);
      }
    }
  }
  return rows;
}

export function createStarburstApplications(config: StarburstConnectionConfig): ApplicationsSource {
  return {
    async listApplications(): Promise<ApplicationRow[]> {
      const client = getClient(config);
      const rows = await runQuery(
        client,
        `SELECT ${selectColumns(APPLICATIONS_COLUMN_MAP)} FROM ${config.table}`
      );
      return rows as unknown as ApplicationRow[];
    },
  };
}

export function createStarburstUsers(config: StarburstConnectionConfig): UsersSource {
  return {
    async listUsers(): Promise<UserRow[]> {
      const client = getClient(config);
      const rows = await runQuery(
        client,
        `SELECT ${selectColumns(USERS_COLUMN_MAP)} FROM ${config.table}`
      );
      return rows as unknown as UserRow[];
    },
  };
}

function rowToConversation(row: Record<string, unknown>): Conversation {
  return {
    id: String(row.id),
    name: String(row.name),
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

/**
 * Conversation CRUD requires the underlying Trino connector to support
 * DML (INSERT/UPDATE/DELETE) - this depends on which catalog backs the
 * table (e.g. Iceberg/Delta/Hive-ACID and JDBC-backed connectors to a
 * real RDBMS generally do; some read-optimized connectors don't). If
 * the real catalog is read-only, point CONVERSATIONS_BACKEND at a
 * writable backend (sqlite/postgres/sqlserver) instead.
 */
export function createStarburstConversations(config: StarburstConnectionConfig): ConversationsSource {
  const c = CONVERSATIONS_COLUMN_MAP;
  const table = config.table;

  return {
    async list(): Promise<Conversation[]> {
      const client = getClient(config);
      const rows = await runQuery(
        client,
        `SELECT ${selectColumns(c)} FROM ${table} ORDER BY ${c.updated_at} DESC`
      );
      return rows.map(rowToConversation);
    },

    async create(name?: string): Promise<Conversation> {
      const client = getClient(config);
      const id = crypto.randomUUID();
      const safeName = (name?.trim() || "New conversation").replace(/'/g, "''");
      await runQuery(
        client,
        `INSERT INTO ${table} (${c.id}, ${c.name}, ${c.created_at}, ${c.updated_at})
         VALUES ('${id}', '${safeName}', now(), now())`
      );
      return { id, name: name?.trim() || "New conversation", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    },

    async rename(id: string, name: string): Promise<Conversation | null> {
      const client = getClient(config);
      const safeName = name.trim().replace(/'/g, "''");
      await runQuery(
        client,
        `UPDATE ${table} SET ${c.name} = '${safeName}', ${c.updated_at} = now() WHERE ${c.id} = '${id}'`
      );
      const rows = await runQuery(
        client,
        `SELECT ${selectColumns(c)} FROM ${table} WHERE ${c.id} = '${id}'`
      );
      return rows[0] ? rowToConversation(rows[0]) : null;
    },

    async touch(id: string): Promise<void> {
      const client = getClient(config);
      await runQuery(client, `UPDATE ${table} SET ${c.updated_at} = now() WHERE ${c.id} = '${id}'`);
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient(config);
      await runQuery(client, `DELETE FROM ${table} WHERE ${c.id} = '${id}'`);
      return true;
    },
  };
}
