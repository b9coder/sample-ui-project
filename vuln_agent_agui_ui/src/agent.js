// Single shared AG-UI HttpAgent for the whole app (module-level, so
// StrictMode's double-render in dev doesn't spin up two connections).
import { HttpAgent } from "@ag-ui/client";

const AGUI_URL = import.meta.env.VITE_AGUI_URL || "http://localhost:8002/agui";

export const aguiAgent = new HttpAgent({
  url: AGUI_URL,
  threadId: crypto.randomUUID(),
});
