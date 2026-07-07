import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { FilterPanelSpec } from "../../dashboard/types";
import { SearchableMultiSelect } from "../../dashboard/SearchableMultiSelect";
import type { UIComponent, UIData } from "../types";
import { resolveDataRef } from "../resolveDataRef";

const SAVED_FILTERS_KEY = "one_search_saved_filters";

function FilterForm({
  spec,
  title,
  onApply,
}: {
  spec: FilterPanelSpec;
  title?: string;
  onApply: (values: Record<string, unknown>) => void;
}) {
  const { fields } = spec;
  const [values, setValues] = useState<Record<string, unknown>>(spec.values ?? {});

  useEffect(() => {
    setValues(spec.values ?? {});
  }, [spec.values]);

  function setField(name: string, value: unknown) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  function toggleMultiSelect(name: string, option: string) {
    setValues((prev) => {
      const current = (prev[name] as string[]) ?? [];
      const next = current.includes(option)
        ? current.filter((v) => v !== option)
        : [...current, option];
      return { ...prev, [name]: next };
    });
  }

  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-5">
        <CardTitle className="text-sm">{title ?? "Refine results"}</CardTitle>
      </CardHeader>
      <CardContent className="px-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((field) => (
            <div key={field.name} className="flex flex-col gap-1.5">
              {field.component === "checkbox" ? (
                <Label className="cursor-pointer">
                  <Checkbox
                    checked={Boolean(values[field.name])}
                    onCheckedChange={(c) => setField(field.name, c === true)}
                  />
                  {field.label}
                </Label>
              ) : (
                <>
                  <Label>{field.label}</Label>
                  {field.component === "text" && (
                    <Input
                      value={(values[field.name] as string) ?? ""}
                      onChange={(e) => setField(field.name, e.target.value)}
                    />
                  )}
                  {field.component === "searchableMultiSelect" && field.entitySource && (
                    <SearchableMultiSelect
                      entitySource={field.entitySource}
                      selected={(values[field.name] as string[]) ?? []}
                      onChange={(next) => setField(field.name, next)}
                      placeholder={`Search ${field.label.toLowerCase()}…`}
                    />
                  )}
                  {field.component === "multiSelect" && (
                    <div className="flex flex-wrap gap-1.5">
                      {(field.options ?? []).map((opt) => {
                        const selected = ((values[field.name] as string[]) ?? []).includes(opt);
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => toggleMultiSelect(field.name, opt)}
                            className={cn(
                              "rounded-full border px-3 py-1 text-xs transition-colors",
                              selected
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-transparent text-muted-foreground hover:border-primary/60"
                            )}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onApply(values)}>
            Apply Filters
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setValues({});
              onApply({});
            }}
          >
            Clear
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(values))}
          >
            Save
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const raw = localStorage.getItem(SAVED_FILTERS_KEY);
              if (!raw) return;
              try {
                const saved = JSON.parse(raw);
                setValues(saved);
                onApply(saved);
              } catch {
                /* ignore malformed saved filters */
              }
            }}
          >
            Load Saved
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function FilterFormElement({
  component,
  data,
  onApplyFilters,
}: {
  component: UIComponent;
  data: UIData;
  onApplyFilters: (values: Record<string, unknown>) => void;
}) {
  if (component.formId !== "vulnerability_filters") return null;
  const resolved = resolveDataRef(data, component.dataRef) as FilterPanelSpec | undefined;
  if (!resolved) return null;
  return (
    <div className="rounded-xl border border-dashed border-border/70 p-1">
      <div className="px-4 py-2 text-xs text-muted-foreground">
        Refine the filters below to see updated results
      </div>
      <FilterForm spec={resolved} title={component.title} onApply={onApplyFilters} />
    </div>
  );
}
