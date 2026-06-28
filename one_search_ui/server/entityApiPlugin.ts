import type { Plugin } from "vite";
import { getApplicationsSource, getUsersSource } from "./dataSources/index.ts";

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/**
 * Vite dev-server middleware exposing read-only reference data for the
 * searchable Application/Owner filter dropdowns - GET /api/applications
 * and GET /api/users. Each resource independently picks its backend
 * (sqlite/postgres/sqlserver/starburst) via APPLICATIONS_BACKEND/
 * USERS_BACKEND env vars - see dataSources/config.ts. Dev-only, same as
 * conversationsPlugin.ts.
 */
export function entityApiPlugin(): Plugin {
  return {
    name: "entity-api",
    configureServer(server) {
      server.middlewares.use("/api/applications", async (_req, res) => {
        try {
          sendJson(res, 200, await getApplicationsSource().listApplications());
        } catch (err) {
          sendJson(res, 500, { error: (err as Error).message });
        }
      });

      server.middlewares.use("/api/users", async (_req, res) => {
        try {
          sendJson(res, 200, await getUsersSource().listUsers());
        } catch (err) {
          sendJson(res, 500, { error: (err as Error).message });
        }
      });

      // eslint-disable-next-line no-console
      console.log("[entity-api] mounted at /api/applications and /api/users");
    },
  };
}
