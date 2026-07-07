// The A2UI catalog for this app: a2ui's shipped basicCatalog
// (Row/Column/Card/Text/Divider/...) plus this project's custom
// visualizations, each defined in its own file and imported here as an
// a2ui component implementation. CATALOG_ID must match
// a2ui_agent/a2ui_schema.py - the backend names it in every
// createSurface message, and MessageProcessor only renders components
// defined in the catalog with that id.
import { Catalog } from "@a2ui/web_core/v0_9";
import { basicCatalog } from "@a2ui/react/v0_9";
import { ChartImplementation } from "./Chart";
import { KpiImplementation } from "./Kpi";
import { MarkdownImplementation } from "./Markdown";
import { DownloadImplementation } from "./Download";
import { TableImplementation } from "./Table";
import { FilterImplementation } from "./Filter";

export const CATALOG_ID = "a2ui-vuln-catalog-v1";

export const vulnCatalog = new Catalog(
  CATALOG_ID,
  [
    ...basicCatalog.components.values(),
    ChartImplementation,
    KpiImplementation,
    MarkdownImplementation,
    DownloadImplementation,
    TableImplementation,
    FilterImplementation,
  ],
  Array.from(basicCatalog.functions.values())
);
