// The custom A2UI "Markdown" visualization - a2ui's Text has no markdown
// rendering (that's an optional plugin), so this renders the agent's
// narration with react-markdown. Markdown is free-form narration, not a
// data binding, so it carries no trust badge.
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { z } from "zod";
import type { ComponentApi } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import type { ElementMeta } from "./manifest";

// Authoring contract + metadata for a markdown narration element.
export const markdownElementSchema = z.object({
  text: z.string().describe("Short narration/insight in markdown."),
});

export const markdownMeta: ElementMeta = {
  type: "markdown",
  component: "Markdown",
  placement: "combinable",
  dataRefProps: [],
  dataBinding: null,
};

const MarkdownApi: ComponentApi = {
  name: "Markdown",
  schema: z.object({ text: z.string(), weight: z.number().optional() }).strict(),
};

export const MarkdownImplementation = createComponentImplementation(MarkdownApi, ({ props }) => (
  <div className="a2ui-markdown">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{(props.text as string) || ""}</ReactMarkdown>
  </div>
));
