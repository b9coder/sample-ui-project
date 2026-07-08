// The custom A2UI "DownloadLink" visualization - a2ui's basicCatalog has
// no link primitive, so this renders a real, clickable <a href> download
// button. The URL is injected by the backend from the summary export, so
// it always points at trusted data (no per-element trust badge needed -
// a link has no data values to verify).
import { z } from "zod";
import type { ComponentApi } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import type { ElementMeta } from "./manifest";

// Authoring contract + metadata for a download element. The URL is
// server-injected from the "summary_export" data binding; the LLM only
// (optionally) authors the label.
export const downloadElementSchema = z.object({
  label: z.string().optional().describe("Button text; server fills the URL."),
});

export const downloadMeta: ElementMeta = {
  type: "download",
  component: "DownloadLink",
  placement: "solo",
  dataRefProps: [],
  dataBinding: "summary_export",
};

const DownloadLinkApi: ComponentApi = {
  name: "DownloadLink",
  schema: z
    .object({
      label: z.string(),
      url: z.string(),
      weight: z.number().optional(),
    })
    .strict(),
};

export const DownloadImplementation = createComponentImplementation(DownloadLinkApi, ({ props }) => (
  <a
    className="a2ui-download-link"
    href={props.url as string}
    target="_blank"
    rel="noopener noreferrer"
    style={typeof props.weight === "number" ? { flex: `${props.weight}` } : undefined}
  >
    <span className="a2ui-download-icon" aria-hidden>
      ⬇
    </span>
    {(props.label as string) || "Download"}
  </a>
));
