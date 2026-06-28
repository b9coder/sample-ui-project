import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The same SQLite file vulnerability_mcp/seed_data.py seeds and
// one_search_agent reads via the MCP server - read directly here
// (read-only) so the React app's filter dropdowns have a real Node.js
// API to call without round-tripping through the Python agent.
// This file lives at one_search_ui/server/, so the DB two levels up
// (claud-playground/vulnerabilities.db) matches VULN_MCP_PROJECT_DIR's
// default in one_search_agent/agent.py.
const DB_PATH = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "vulnerabilities.db");

export interface ApplicationRow {
  application_id: string;
  application_name: string;
  business_unit: string | null;
  environment: string | null;
  owner_ecn: string | null;
  description: string | null;
}

export interface UserRow {
  ecn: string;
  first_name: string;
  last_name: string;
  email: string | null;
  band: string | null;
  department: string | null;
  role: string | null;
}

function query<T>(table: "application_details" | "user_details"): T[] {
  if (!existsSync(DB_PATH)) return [];
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    return db.prepare(`SELECT * FROM ${table}`).all() as T[];
  } finally {
    db.close();
  }
}

export function listApplications(): ApplicationRow[] {
  return query<ApplicationRow>("application_details");
}

export function listUsers(): UserRow[] {
  return query<UserRow>("user_details");
}
