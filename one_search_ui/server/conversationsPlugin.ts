import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getConversationsSource } from "./dataSources/index.ts";

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  if (status === 204 || body === null) {
    res.end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/**
 * Vite dev-server middleware exposing CRUD for conversation metadata
 * (id/name/timestamps - not message content, see dataSources/) directly
 * inside the same process as `npm run dev`, under /api/conversations.
 * Backed by whichever store CONVERSATIONS_BACKEND selects (sqlite by
 * default - see dataSources/config.ts). Dev-only, same as the rest of
 * this project's setup - there's no production server to attach this to.
 */
export function conversationsApiPlugin(): Plugin {
  return {
    name: "conversations-api",
    configureServer(server) {
      server.middlewares.use("/api/conversations", async (req, res, _next) => {
        try {
          const store = getConversationsSource();
          const url = new URL(req.url ?? "/", "http://localhost");
          const segments = url.pathname.split("/").filter(Boolean);
          const id = segments[0];
          const subresource = segments[1];

          if (req.method === "GET" && !id) {
            return sendJson(res, 200, await store.list());
          }

          if (req.method === "POST" && !id) {
            const body = await readJsonBody(req);
            const conversation = await store.create(
              typeof body.name === "string" ? body.name : undefined
            );
            return sendJson(res, 201, conversation);
          }

          if (req.method === "PATCH" && id && !subresource) {
            const body = await readJsonBody(req);
            if (typeof body.name !== "string" || !body.name.trim()) {
              return sendJson(res, 400, { error: "name is required" });
            }
            const updated = await store.rename(id, body.name);
            if (!updated) return sendJson(res, 404, { error: "not found" });
            return sendJson(res, 200, updated);
          }

          if (req.method === "POST" && id && subresource === "touch") {
            await store.touch(id);
            return sendJson(res, 204, null);
          }

          if (req.method === "DELETE" && id && !subresource) {
            const deleted = await store.delete(id);
            if (!deleted) return sendJson(res, 404, { error: "not found" });
            return sendJson(res, 204, null);
          }

          return sendJson(res, 405, { error: "method not allowed" });
        } catch (err) {
          sendJson(res, 500, { error: (err as Error).message });
        }
      });
      // eslint-disable-next-line no-console
      console.log("[conversations-api] mounted at /api/conversations");
    },
  };
}
