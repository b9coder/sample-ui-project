// The per-element metadata the UI project shares with the agent via the
// generated catalog manifest (see scripts/gen-catalog.ts). Each
// visualization file exports an `elementSchema` (the authoring contract
// the agent's LLM fills) and a `meta` describing how the agent must
// treat it. This is the single source of truth for "what layouts the UI
// supports" - the agent consumes the generated JSON, so the two projects
// evolve independently without hand-syncing schemas.
import type { ZodTypeAny } from "zod";

export interface ElementMeta {
  // The layout element type the agent emits (e.g. "chart").
  type: string;
  // The a2ui component name this element renders as (e.g. "Chart").
  component: string;
  // "solo": must occupy its own full-width row, never combined with
  // other content. "combinable": may share a row with other combinables.
  placement: "solo" | "combinable";
  // Authoring props that are TRUSTED data references (dotted paths the
  // agent resolves against tool output). Presence of a resolved ref
  // marks the visualization trusted; absence => AI-generated.
  dataRefProps: string[];
  // Named server-injected dataset this element needs (the agent has a
  // data provider per name), or null for purely LLM/ref-driven elements.
  dataBinding: string | null;
}

export interface ElementDefinition {
  elementSchema: ZodTypeAny;
  meta: ElementMeta;
}
