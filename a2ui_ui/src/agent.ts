// Single shared AG-UI HttpAgent talking to the a2ui_agent backend.
import { HttpAgent } from "@ag-ui/client";

const AGUI_URL = import.meta.env.VITE_AGUI_URL || "http://localhost:8004/agui";

// Simulates the Okta gateway's trusted X-Employee-Id header. Pin a
// seeded ECN (see vulnerability_mcp seed output) to scope all queries
// to that user's access; blank = unrestricted local dev.
export const DEV_EMPLOYEE_ID = import.meta.env.VITE_DEV_EMPLOYEE_ID || "";

export const aguiAgent = new HttpAgent({
  url: AGUI_URL,
  threadId: crypto.randomUUID(),
  headers: DEV_EMPLOYEE_ID ? { "X-Employee-Id": DEV_EMPLOYEE_ID } : {},
});
