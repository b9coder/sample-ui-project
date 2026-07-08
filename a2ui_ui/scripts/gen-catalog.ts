// Generates catalog.manifest.json - the shared contract between this UI
// project and the a2ui_agent backend. Run: `npm run gen:catalog`.
//
// The UI project OWNS the supported layouts: each visualization file
// declares an `elementSchema` (the authoring contract the agent's LLM
// fills) + `meta` (component name, placement, data references, data
// binding). This script converts each zod schema to JSON Schema and
// writes them all into one versioned manifest. The agent reads that JSON
// to drive its structured output + compiler rules, so neither side
// hand-copies the other's schema. A CI check can diff the regenerated
// manifest against the committed one to fail on drift.
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";
import type { ElementMeta } from "../src/a2ui/manifest";

import { chartElementSchema, chartMeta } from "../src/a2ui/Chart";
import { kpiElementSchema, kpiMeta } from "../src/a2ui/Kpi";
import { markdownElementSchema, markdownMeta } from "../src/a2ui/Markdown";
import { downloadElementSchema, downloadMeta } from "../src/a2ui/Download";
import { tableElementSchema, tableMeta } from "../src/a2ui/Table";
import { filterElementSchema, filterMeta } from "../src/a2ui/Filter";
import { CATALOG_ID } from "../src/a2ui/catalog";

// Bump when the contract changes; the agent negotiates against this.
const CATALOG_VERSION = "1.0.0";

const REGISTRY: { schema: ZodTypeAny; meta: ElementMeta }[] = [
  { schema: markdownElementSchema, meta: markdownMeta },
  { schema: kpiElementSchema, meta: kpiMeta },
  { schema: chartElementSchema, meta: chartMeta },
  { schema: tableElementSchema, meta: tableMeta },
  { schema: downloadElementSchema, meta: downloadMeta },
  { schema: filterElementSchema, meta: filterMeta },
];

const manifest = {
  catalogId: CATALOG_ID,
  version: CATALOG_VERSION,
  generatedBy: "a2ui_ui/scripts/gen-catalog.ts",
  elements: REGISTRY.map(({ schema, meta }) => ({
    ...meta,
    props: zodToJsonSchema(schema, { target: "jsonSchema7", $refStrategy: "none" }),
  })),
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "..", "catalog.manifest.json");
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(
  `Wrote ${outPath} - ${manifest.elements.length} elements, ` +
    `catalog ${manifest.catalogId} v${manifest.version}`
);
