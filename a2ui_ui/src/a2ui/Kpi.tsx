// The custom A2UI "Kpi" visualization: a headline number tile (label +
// value) with a trust badge. One atomic component so a number never
// renders unlabeled, and so its trust state is always shown.
import { z } from "zod";
import type { ComponentApi } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { TrustBadge } from "./TrustBadge";

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
