// Renders the "filter_panel" element. Editing controls locally, then
// "Apply filters" sends the structured filters back through the chat
// (App passes onApplyFilters -> POST /chat with `filters`).
import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import clsx from "clsx";
import { Card, CardContent, Button, Badge } from "../ui/primitives.jsx";

function MultiSelect({ field, value, onChange }) {
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const toggle = (v) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {field.options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => toggle(o.value)}
          className={clsx(
            "rounded-full border px-2.5 py-0.5 text-xs capitalize transition-colors",
            selected.includes(o.value)
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card hover:bg-muted"
          )}
        >
          {o.label || o.value}
        </button>
      ))}
    </div>
  );
}

function Toggle({ value, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(value === true ? null : true)}
      className={clsx(
        "relative h-5 w-9 rounded-full transition-colors",
        value === true ? "bg-primary" : "bg-muted border border-border"
      )}
    >
      <span
        className={clsx(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all",
          value === true ? "left-[18px]" : "left-0.5"
        )}
      />
    </button>
  );
}

function DateRange({ value, onChange }) {
  const v = value || {};
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="date"
        value={v.after || ""}
        onChange={(e) => onChange({ ...v, after: e.target.value || null })}
        className="rounded-lg border border-border px-2 py-1 text-xs"
      />
      <span className="text-xs text-muted-foreground">to</span>
      <input
        type="date"
        value={v.before || ""}
        onChange={(e) => onChange({ ...v, before: e.target.value || null })}
        className="rounded-lg border border-border px-2 py-1 text-xs"
      />
    </div>
  );
}

export default function FilterPanelElement({ element, onApplyFilters }) {
  const initial = Object.fromEntries(element.fields.map((f) => [f.id, f.value ?? null]));
  const [values, setValues] = useState(initial);
  const set = (id, v) => setValues((prev) => ({ ...prev, [id]: v }));

  const appliedChips = element.fields.filter(
    (f) => f.value !== null && f.value !== undefined && String(f.value) !== ""
  );

  const apply = () => {
    const filters = {};
    for (const f of element.fields) {
      const v = values[f.id];
      if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue;
      if (f.control === "daterange") {
        if (v.after) filters[`${f.id}_after`] = v.after;
        if (v.before) filters[`${f.id}_before`] = v.before;
      } else if (f.control === "text" && typeof v === "string") {
        filters[f.id] = v.split(",").map((s) => s.trim()).filter(Boolean);
      } else {
        filters[f.id] = v;
      }
    }
    onApplyFilters?.(filters);
  };

  return (
    <Card>
      <CardContent>
        <div className="mb-3 flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{element.title || "Filters"}</h3>
          {appliedChips.map((f) => (
            <Badge key={f.id} intent="default">
              {f.label}: {Array.isArray(f.value) ? f.value.join(", ") : String(f.value)}
            </Badge>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {element.fields.map((f) => (
            <div key={f.id} className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">{f.label}</label>
              {f.control === "multiselect" || f.control === "select" ? (
                <MultiSelect field={f} value={values[f.id]} onChange={(v) => set(f.id, v)} />
              ) : f.control === "toggle" ? (
                <Toggle value={values[f.id]} onChange={(v) => set(f.id, v)} />
              ) : f.control === "daterange" ? (
                <DateRange value={values[f.id]} onChange={(v) => set(f.id, v)} />
              ) : (
                <input
                  type="text"
                  placeholder="comma-separated"
                  value={Array.isArray(values[f.id]) ? values[f.id].join(", ") : values[f.id] || ""}
                  onChange={(e) => set(f.id, e.target.value)}
                  className="rounded-lg border border-border px-2 py-1 text-xs"
                />
              )}
            </div>
          ))}
        </div>
        <div className="mt-4">
          <Button onClick={apply}>{element.submit_label || "Apply filters"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
