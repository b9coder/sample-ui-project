// Single shared A2UI MessageProcessor for the whole app: feed it raw
// `a2ui_operations` arrays (the createSurface/updateComponents/
// updateDataModel messages our backend's generate_a2ui tool emits) and
// it maintains the live SurfaceModel(s) that <A2uiSurface> renders.
import { MessageProcessor } from "@a2ui/web_core/v0_9";
import { basicCatalog } from "@a2ui/react/v0_9";

// Called whenever the user clicks a Button/etc. with an action bound to
// it. A2UI actions carry an optional `context` of resolved data-path
// values (see A2UI's "submit a form" pattern) - we just log + surface
// them as a synthetic chat message so the agent can react to the
// selection on the next turn.
let actionListener = null;

export function setA2uiActionListener(fn) {
  actionListener = fn;
}

export const a2uiProcessor = new MessageProcessor([basicCatalog], (action) => {
  if (actionListener) actionListener(action);
});
