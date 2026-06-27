import { useEffect, useState } from "react";
import type { FilterPanelSpec } from "./types";

const SAVED_FILTERS_KEY = "one_search_saved_filters";

export function FilterPanel({
  spec,
  onApply,
}: {
  spec: FilterPanelSpec;
  onApply: (values: Record<string, unknown>) => void;
}) {
  const { fields } = spec;
  const [values, setValues] = useState<Record<string, unknown>>(spec.values ?? {});

  // Keep the panel's displayed selections in sync with whatever the
  // backend says is currently applied (e.g. after a fresh search).
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

  function apply() {
    onApply(values);
  }

  function clear() {
    setValues({});
    onApply({});
  }

  function save() {
    localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(values));
  }

  function loadSaved() {
    const raw = localStorage.getItem(SAVED_FILTERS_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw);
      setValues(saved);
      onApply(saved);
    } catch {
      // ignore malformed saved filters
    }
  }

  return (
    <div className="osa-filter-panel">
      <div className="osa-filter-panel-title">Filters</div>
      <div className="osa-filter-fields">
        {fields.map((field) => (
          <div key={field.name} className="osa-filter-field">
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
            {field.component === "select" && (
              <select
                value={(values[field.name] as string) ?? ""}
                onChange={(e) => setField(field.name, e.target.value)}
              >
                <option value="">Any</option>
                {(field.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            )}
            {field.component === "multiSelect" && (
              <div className="osa-multiselect">
                {(field.options ?? []).map((opt) => {
                  const selected = ((values[field.name] as string[]) ?? []).includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      className={`osa-chip ${selected ? "selected" : ""}`}
                      onClick={() => toggleMultiSelect(field.name, opt)}
                    >
                      {opt}
                    </button>
                  );
                })}
                {(!field.options || field.options.length === 0) && (
                  <input
                    type="text"
                    placeholder="comma-separated values"
                    value={((values[field.name] as string[]) ?? []).join(", ")}
                    onChange={(e) =>
                      setField(
                        field.name,
                        e.target.value
                          .split(",")
                          .map((v) => v.trim())
                          .filter(Boolean)
                      )
                    }
                  />
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="osa-filter-actions">
        <button className="osa-btn primary" onClick={apply}>
          Apply Filters
        </button>
        <button className="osa-btn" onClick={clear}>
          Clear
        </button>
        <button className="osa-btn" onClick={save}>
          Save
        </button>
        <button className="osa-btn" onClick={loadSaved}>
          Load Saved
        </button>
      </div>
    </div>
  );
}
