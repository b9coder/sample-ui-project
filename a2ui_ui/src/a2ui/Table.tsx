// The custom a2ui "Table" visualization: an interactive records table
// (sortable columns, pagination, CSV export). Rows are injected by the
// backend from get_vulnerability_records, so a table is always trusted.
import { useMemo, useState } from "react";
import { z } from "zod";
import type { ComponentApi } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { TrustBadge } from "./TrustBadge";

export interface TableColumn {
  key: string;
  label: string;
}

const PAGE_SIZE = 10;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function Table({
  title,
  columns,
  rows,
  trusted,
}: {
  title: string;
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  trusted?: boolean;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === bv) return 0;
      return (av as never) > (bv as never) ? sortDir : -sortDir;
    });
  }, [rows, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(1);
    }
  }

  function exportCsv() {
    const header = columns.map((c) => c.label).join(",");
    const lines = sorted.map((row) =>
      columns.map((c) => JSON.stringify(cellText(row[c.key]))).join(",")
    );
    const blob = new Blob([header + "\n" + lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vulnerabilities-preview.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="a2ui-table">
      <div className="a2ui-table-header">
        <span className="a2ui-viz-header">
          <span className="a2ui-table-title">{title}</span>
          <TrustBadge trusted={trusted} />
        </span>
        <button className="a2ui-btn" onClick={exportCsv}>
          Export page
        </button>
      </div>
      <div className="a2ui-table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} onClick={() => toggleSort(col.key)}>
                  {col.label}
                  {sortKey === col.key ? (sortDir === 1 ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr key={i}>
                {columns.map((col) => (
                  <td key={col.key}>{cellText(row[col.key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="a2ui-table-footer">
        <button className="a2ui-btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          Prev
        </button>
        <span>
          Page {page + 1} of {totalPages} ({rows.length} rows)
        </span>
        <button
          className="a2ui-btn"
          disabled={page >= totalPages - 1}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

const TableApi: ComponentApi = {
  name: "Table",
  schema: z
    .object({
      title: z.string(),
      columns: z.array(z.object({ key: z.string(), label: z.string() })),
      rows: z.array(z.record(z.string(), z.unknown())),
      trusted: z.boolean().optional(),
      weight: z.number().optional(),
    })
    .strict(),
};

export const TableImplementation = createComponentImplementation(TableApi, ({ props }) => (
  <Table
    title={props.title as string}
    columns={props.columns as TableColumn[]}
    rows={props.rows as Record<string, unknown>[]}
    trusted={props.trusted as boolean | undefined}
  />
));
