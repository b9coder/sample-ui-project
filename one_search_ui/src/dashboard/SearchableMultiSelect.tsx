import { useEffect, useMemo, useRef, useState } from "react";
import type { EntitySource } from "./types";
import { fetchApplicationOptions, fetchUserOptions } from "./entityApi";

interface Option {
  value: string;
  label: string;
}

const FETCHERS: Record<EntitySource, () => Promise<Option[]>> = {
  applications: fetchApplicationOptions,
  users: fetchUserOptions,
};

export function SearchableMultiSelect({
  entitySource,
  selected,
  onChange,
  placeholder,
}: {
  entitySource: EntitySource;
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    FETCHERS[entitySource]()
      .then((rows) => {
        if (!cancelled) setOptions(rows);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entitySource]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const optionsByValue = useMemo(() => {
    const map = new Map<string, Option>();
    for (const opt of options) map.set(opt.value, opt);
    return map;
  }, [options]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
    return pool.slice(0, 50);
  }, [options, query]);

  function toggle(value: string) {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    onChange(next);
  }

  function remove(value: string) {
    onChange(selected.filter((v) => v !== value));
  }

  return (
    <div className="osa-searchable-select" ref={containerRef}>
      {selected.length > 0 && (
        <div className="osa-searchable-select-chips">
          {selected.map((value) => (
            <span key={value} className="osa-chip selected">
              {optionsByValue.get(value)?.label ?? value}
              <button
                type="button"
                className="osa-chip-remove"
                onClick={() => remove(value)}
                aria-label="Remove"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        placeholder={loading ? "Loading…" : placeholder ?? "Search…"}
        value={query}
        disabled={loading}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
      />
      {open && !loading && (
        <div className="osa-searchable-select-menu">
          {filtered.length === 0 && (
            <div className="osa-searchable-select-empty">No matches</div>
          )}
          {filtered.map((opt) => (
            <div
              key={opt.value}
              className={`osa-searchable-select-option ${
                selected.includes(opt.value) ? "selected" : ""
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                toggle(opt.value);
              }}
            >
              <input type="checkbox" checked={selected.includes(opt.value)} readOnly />
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
