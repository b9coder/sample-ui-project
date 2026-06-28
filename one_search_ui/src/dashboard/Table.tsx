import { useMemo, useState } from "react";
import type { TableSpec } from "./types";

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function Table({ spec }: { spec: TableSpec }) {
  const { columns, rows, pageSize = 10 } = spec;
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [page, setPage] = useState(0);

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === bv) return 0;
      return (av as never) > (bv as never) ? sortDir : -sortDir;
    });
  }, [rows, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const pageRows = sortedRows.slice(page * pageSize, (page + 1) * pageSize);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(1);
    }
  }

  function exportCsv() {
    const header = columns.map((c) => c.label).join(",");
    const lines = sortedRows.map((row) =>
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
    <div className="osa-table-wrap">
      <div className="osa-table-header">
        <div className="osa-table-title">Vulnerability Records</div>
        <button className="osa-btn" onClick={exportCsv}>
          Export page
        </button>
      </div>
      <div className="osa-table-scroll">
        <table className="osa-table">
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
      <div className="osa-table-pagination">
        <button className="osa-btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          Prev
        </button>
        <span>
          Page {page + 1} of {totalPages} ({rows.length} rows)
        </span>
        <button
          className="osa-btn"
          disabled={page >= totalPages - 1}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
