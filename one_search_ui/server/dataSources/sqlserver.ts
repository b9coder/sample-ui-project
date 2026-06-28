import sql from "mssql";
import type { MssqlConnectionConfig } from "./config.ts";
import type {
  ApplicationRow,
  ApplicationsSource,
  Conversation,
  ConversationsSource,
  UserRow,
  UsersSource,
} from "./types.ts";

// *** PLACEHOLDER column names - edit COLUMN_MAP below to match the
// real SQL Server schema before pointing a resource's *_BACKEND at
// "sqlserver". Only the right-hand strings need to change.
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

const pools = new Map<string, Promise<sql.ConnectionPool>>();

function getPool(config: MssqlConnectionConfig): Promise<sql.ConnectionPool> {
  const key = `${config.host}:${config.port}/${config.database}`;
  let pool = pools.get(key);
  if (!pool) {
    pool = new sql.ConnectionPool({
      server: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      options: { encrypt: true, trustServerCertificate: false },
    }).connect();
    pools.set(key, pool);
  }
  return pool;
}

function selectColumns(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([alias, real]) => `${real} AS ${alias}`)
    .join(", ");
}

export function createSqlServerApplications(config: MssqlConnectionConfig): ApplicationsSource {
  return {
    async listApplications(): Promise<ApplicationRow[]> {
      const pool = await getPool(config);
      const result = await pool.request().query(
        `SELECT ${selectColumns(APPLICATIONS_COLUMN_MAP)} FROM ${config.table}`
      );
      return result.recordset;
    },
  };
}

export function createSqlServerUsers(config: MssqlConnectionConfig): UsersSource {
  return {
    async listUsers(): Promise<UserRow[]> {
      const pool = await getPool(config);
      const result = await pool.request().query(
        `SELECT ${selectColumns(USERS_COLUMN_MAP)} FROM ${config.table}`
      );
      return result.recordset;
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

export function createSqlServerConversations(config: MssqlConnectionConfig): ConversationsSource {
  const c = CONVERSATIONS_COLUMN_MAP;
  const table = config.table;

  return {
    async list(): Promise<Conversation[]> {
      const pool = await getPool(config);
      const result = await pool
        .request()
        .query(`SELECT ${selectColumns(c)} FROM ${table} ORDER BY ${c.updated_at} DESC`);
      return result.recordset.map(rowToConversation);
    },

    async create(name?: string): Promise<Conversation> {
      const pool = await getPool(config);
      const result = await pool
        .request()
        .input("name", sql.NVarChar, name?.trim() || "New conversation")
        .query(
          `INSERT INTO ${table} (${c.name})
           OUTPUT INSERTED.${c.id} AS id, INSERTED.${c.name} AS name,
                  INSERTED.${c.created_at} AS created_at, INSERTED.${c.updated_at} AS updated_at
           VALUES (@name)`
        );
      return rowToConversation(result.recordset[0]);
    },

    async rename(id: string, name: string): Promise<Conversation | null> {
      const pool = await getPool(config);
      const result = await pool
        .request()
        .input("id", sql.NVarChar, id)
        .input("name", sql.NVarChar, name.trim())
        .query(
          `UPDATE ${table} SET ${c.name} = @name, ${c.updated_at} = SYSUTCDATETIME()
           OUTPUT INSERTED.${c.id} AS id, INSERTED.${c.name} AS name,
                  INSERTED.${c.created_at} AS created_at, INSERTED.${c.updated_at} AS updated_at
           WHERE ${c.id} = @id`
        );
      return result.recordset[0] ? rowToConversation(result.recordset[0]) : null;
    },

    async touch(id: string): Promise<void> {
      const pool = await getPool(config);
      await pool
        .request()
        .input("id", sql.NVarChar, id)
        .query(`UPDATE ${table} SET ${c.updated_at} = SYSUTCDATETIME() WHERE ${c.id} = @id`);
    },

    async delete(id: string): Promise<boolean> {
      const pool = await getPool(config);
      const result = await pool
        .request()
        .input("id", sql.NVarChar, id)
        .query(`DELETE FROM ${table} WHERE ${c.id} = @id`);
      return (result.rowsAffected[0] ?? 0) > 0;
    },
  };
}
