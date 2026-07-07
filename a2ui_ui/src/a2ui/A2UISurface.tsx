import { useEffect, useState } from "react";
import { MessageProcessor, type SurfaceModel } from "@a2ui/web_core/v0_9";
import { A2uiSurface, type ReactComponentImplementation } from "@a2ui/react/v0_9";
import { vulnCatalog } from "./catalog";

// Feeds a backend-generated a2ui.org message list (createSurface +
// updateComponents) into a real @a2ui/react MessageProcessor and
// renders the resulting surface. The whole UI here is LLM-authored on
// the agent side (see a2ui_agent) - this component just renders it.
export function A2UISurface({ messages }: { messages: unknown[] }) {
  const [surface, setSurface] = useState<SurfaceModel<ReactComponentImplementation> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSurface(null);
    setError(null);
    const processor = new MessageProcessor([vulnCatalog]);
    const sub = processor.onSurfaceCreated((s) => setSurface(s));
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      processor.processMessages(messages as any);
    } catch (err) {
      console.error("A2UI processing failed", err);
      setError((err as Error).message);
    }
    return () => sub.unsubscribe();
  }, [messages]);

  if (error) return <div className="a2ui-error">A2UI render error: {error}</div>;
  if (!surface) return null;

  return (
    <div className="a2ui-surface">
      <A2uiSurface surface={surface} />
    </div>
  );
}
