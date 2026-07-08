// The custom a2ui "Filter" visualization: an interactive filter panel.
// On Apply it calls the ApplyFilters callback from context, which App
// wires to send a [UI_ACTION apply_filters] refinement to the agent.
import { useEffect, useState } from "react";
import { z } from "zod";
import type { ComponentApi } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { useApplyFilters } from "./ApplyFiltersContext";
import type { ElementMeta } from "./manifest";

// Authoring contract + metadata for the filter panel. Fields/values are
// server-injected from the "filter_schema" data binding; the LLM just
// requests the element (no authoring props).
export const filterElementSchema = z.object({});

export const filterMeta: ElementMeta = {
  type: "filter",
  component: "Filter",
  placement: "solo",
  dataRefProps: [],
  dataBinding: "filter_schema",
};

export interface FilterField {
  name: string;
  label: string;
  component: "multiSelect" | "checkbox" | "text";
  options?: string[];
}

export function Filter({
  fields,
  values: initialValues,
}: {
  fields: FilterField[];
  values: Record<string, unknown>;
}) {
  const applyFilters = useApplyFilters();
  const [values, setValues] = useState<Record<string, unknown>>(initialValues ?? {});

  // Reflect the currently-applied filters whenever the surface is rebuilt.
  useEffect(() => {
    setValues(initialValues ?? {});
  }, [initialValues]);

  function setField(name: string, value: unknown) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  function toggleMulti(name: string, option: string) {
    setValues((prev) => {
      const cur = (prev[name] as string[]) ?? [];
      const next = cur.includes(option) ? cur.filter((v) => v !== option) : [...cur, option];
      return { ...prev, [name]: next };
    });
  }

  return (
    <div className="a2ui-filter">
      <div className="a2ui-filter-title">Refine results</div>
      <div className="a2ui-filter-grid">
        {fields.map((field) => (
          <div key={field.name} className="a2ui-filter-field">
            <label>{field.label}</label>
            {field.component === "checkbox" && (
              <input
                type="checkbox"
                checked={Boolean(values[field.name])}
                onChange={(e) => setField(field.name, e.target.checked)}
              />
            )}
            {field.component === "text" && (
              <input
                type="text"
                value={(values[field.name] as string) ?? ""}
                onChange={(e) => setField(field.name, e.target.value)}
              />
            )}
            {field.component === "multiSelect" && (
              <div className="a2ui-chips">
                {(field.options ?? []).map((opt) => {
                  const selected = ((values[field.name] as string[]) ?? []).includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      className={`a2ui-chip ${selected ? "selected" : ""}`}
                      onClick={() => toggleMulti(field.name, opt)}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="a2ui-filter-actions">
        <button className="a2ui-btn primary" onClick={() => applyFilters(values)}>
          Apply Filters
        </button>
        <button
          className="a2ui-btn"
          onClick={() => {
            setValues({});
            applyFilters({});
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

const FilterApi: ComponentApi = {
  name: "Filter",
  schema: z
    .object({
      fields: z.array(
        z.object({
          name: z.string(),
          label: z.string(),
          component: z.enum(["multiSelect", "checkbox", "text"]),
          options: z.array(z.string()).optional(),
        })
      ),
      values: z.record(z.string(), z.unknown()),
      weight: z.number().optional(),
    })
    .strict(),
};

export const FilterImplementation = createComponentImplementation(FilterApi, ({ props }) => (
  <Filter
    fields={props.fields as FilterField[]}
    values={props.values as Record<string, unknown>}
  />
));
