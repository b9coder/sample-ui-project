import { Pool } from "pg";
import type { PgConnectionConfig } from "./config.ts";
import type {
  ApplicationRow,
  ApplicationsSource,
  Conversation,
  ConversationsSource,
  UserRow,
  UsersSource,
} from "./types.ts";

// *** PLACEHOLDER column names - edit COLUMN_MAP below to match the
// real Postgres schema before pointing a resource's *_BACKEND at
// "postgres". Only the right-hand strings (the real column names)
// need to change; the left-hand keys are what the rest of the app
// reads/writes by.
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

const pools = new Map<string, Pool>();

function getPool(config: PgConnectionConfig): Pool {
  const key = `${config.host}:${config.port}/${config.database}`;
  let pool = pools.get(key);
  if (!pool) {
    pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
    });
    pools.set(key, pool);
  }
  return pool;
}

function selectColumns(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([alias, real]) => `${real} AS ${alias}`)
    .join(", ");
}

export function createPostgresApplications(config: PgConnectionConfig): ApplicationsSource {
  return {
    async listApplications(): Promise<ApplicationRow[]> {
      const pool = getPool(config);
      const result = await pool.query(
        `SELECT ${selectColumns(APPLICATIONS_COLUMN_MAP)} FROM ${config.table}`
      );
      return result.rows;
    },
  };
}

export function createPostgresUsers(config: PgConnectionConfig): UsersSource {
  return {
    async listUsers(): Promise<UserRow[]> {
      const pool = getPool(config);
      const result = await pool.query(
        `SELECT ${selectColumns(USERS_COLUMN_MAP)} FROM ${config.table}`
      );
      return result.rows;
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

export function createPostgresConversations(config: PgConnectionConfig): ConversationsSource {
  const c = CONVERSATIONS_COLUMN_MAP;
  const table = config.table;

  return {
    async list(): Promise<Conversation[]> {
      const pool = getPool(config);
      const result = await pool.query(
        `SELECT ${selectColumns(c)} FROM ${table} ORDER BY ${c.updated_at} DESC`
      );
      return result.rows.map(rowToConversation);
    },

    async create(name?: string): Promise<Conversation> {
      const pool = getPool(config);
      const result = await pool.query(
        `INSERT INTO ${table} (${c.name})
         VALUES ($1)
         RETURNING ${selectColumns(c)}`,
        [name?.trim() || "New conversation"]
      );
      return rowToConversation(result.rows[0]);
    },

    async rename(id: string, name: string): Promise<Conversation | null> {
      const pool = getPool(config);
      const result = await pool.query(
        `UPDATE ${table} SET ${c.name} = $1, ${c.updated_at} = now()
         WHERE ${c.id} = $2
         RETURNING ${selectColumns(c)}`,
        [name.trim(), id]
      );
      return result.rows[0] ? rowToConversation(result.rows[0]) : null;
    },

    async touch(id: string): Promise<void> {
      const pool = getPool(config);
      await pool.query(`UPDATE ${table} SET ${c.updated_at} = now() WHERE ${c.id} = $1`, [id]);
    },

    async delete(id: string): Promise<boolean> {
      const pool = getPool(config);
      const result = await pool.query(`DELETE FROM ${table} WHERE ${c.id} = $1`, [id]);
      return (result.rowCount ?? 0) > 0;
    },
  };
}
