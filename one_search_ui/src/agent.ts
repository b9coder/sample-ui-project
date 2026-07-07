// Single shared AG-UI HttpAgent for the whole app (module-level, so
// StrictMode's double-render in dev doesn't spin up two connections).
import { HttpAgent } from "@ag-ui/client";

const AGUI_URL = import.meta.env.VITE_AGUI_URL || "http://localhost:8003/agui";

// Simulates the Okta-validating gateway that injects a trusted
// X-Employee-Id header in production. In local dev the identity is
// pinned via VITE_DEV_EMPLOYEE_ID (see .env) - the agent forwards it
// to the MCP tools, which scope every query to that user's access.
export const DEV_EMPLOYEE_ID = import.meta.env.VITE_DEV_EMPLOYEE_ID || "";

export const aguiAgent = new HttpAgent({
  url: AGUI_URL,
  threadId: crypto.randomUUID(),
  headers: DEV_EMPLOYEE_ID ? { "X-Employee-Id": DEV_EMPLOYEE_ID } : {},
});
