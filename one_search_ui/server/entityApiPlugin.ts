import type { Plugin } from "vite";
import { listApplications, listUsers } from "./entityStore.ts";

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/**
 * Vite dev-server middleware exposing read-only reference data for the
 * searchable Application/Owner filter dropdowns - GET /api/applications
 * and GET /api/users, reading application_details/user_details
 * directly out of the same SQLite file the Python agent's MCP server
 * uses (see entityStore.ts). Dev-only, same as conversationsPlugin.ts.
 */
export function entityApiPlugin(): Plugin {
  return {
    name: "entity-api",
    configureServer(server) {
      server.middlewares.use("/api/applications", (_req, res) => {
        try {
          sendJson(res, 200, listApplications());
        } catch (err) {
          sendJson(res, 500, { error: (err as Error).message });
        }
      });

      server.middlewares.use("/api/users", (_req, res) => {
        try {
          sendJson(res, 200, listUsers());
        } catch (err) {
          sendJson(res, 500, { error: (err as Error).message });
        }
      });

      // eslint-disable-next-line no-console
      console.log("[entity-api] mounted at /api/applications and /api/users");
    },
  };
}
