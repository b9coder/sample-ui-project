// The custom A2UI "Kpi" visualization: a headline number tile (label +
// value) with a trust badge. One atomic component so a number never
// renders unlabeled, and so its trust state is always shown.
import { z } from "zod";
import type { ComponentApi } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { TrustBadge } from "./TrustBadge";
import type { ElementMeta } from "./manifest";

// Authoring contract + metadata for a KPI element. Prefer `valueRef`
// (trusted scalar path); inline `value` is the untrusted fallback.
export const kpiElementSchema = z.object({
  label: z.string(),
  valueRef: z.string().optional().describe("Dotted path to a trusted scalar (preferred)."),
  value: z.string().optional().describe("Inline value ONLY if no valueRef fits (untrusted)."),
});

export const kpiMeta: ElementMeta = {
  type: "kpi",
  component: "Kpi",
  placement: "combinable",
  dataRefProps: ["valueRef"],
  dataBinding: null,
};

export function Kpi({
  label,
  value,
  trusted,
}: {
  label: string;
  value: string;
  trusted?: boolean;
}) {
  return (
    <div className="a2ui-kpi">
      <div className="a2ui-kpi-value">{value}</div>
      <div className="a2ui-kpi-foot">
        <span className="a2ui-kpi-label">{label}</span>
        <TrustBadge trusted={trusted} />
      </div>
    </div>
  );
}

const KpiApi: ComponentApi = {
  name: "Kpi",
  schema: z
    .object({
      label: z.string(),
      value: z.string(),
      trusted: z.boolean().optional(),
      weight: z.number().optional(),
    })
    .strict(),
};

export const KpiImplementation = createComponentImplementation(KpiApi, ({ props }) => (
  <div style={typeof props.weight === "number" ? { flex: `${props.weight}`, minWidth: 0 } : undefined}>
    <Kpi
      label={props.label as string}
      value={props.value as string}
      trusted={props.trusted as boolean | undefined}
    />
  </div>
));
