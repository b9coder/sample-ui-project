import { useState } from "react";
import { Check, Minus } from "lucide-react";
import { Card, CardHeader, CardContent, Button, Badge } from "../ui/primitives.jsx";

function CellValue({ value, format }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  switch (format) {
    case "badge":
      return <Badge>{String(value)}</Badge>;
    case "boolean":
      return value ? (
        <Check className="h-4 w-4 text-red-600" />
      ) : (
        <Minus className="h-4 w-4 text-muted-foreground" />
      );
    case "number":
      return <span className="tabular-nums">{Number(value).toLocaleString()}</span>;
    case "date":
      return <span className="tabular-nums">{String(value)}</span>;
    default:
      return String(value);
  }
}

export default function TableElement({ element }) {
  const pageSize = element.page_size || 10;
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(element.rows.length / pageSize));
  const visible = element.rows.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <Card>
      <CardHeader title={element.title} />
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {element.columns.map((c) => (
                <th key={c.key} className="py-2 pr-4 text-xs font-medium text-muted-foreground">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-muted/50">
                {element.columns.map((c) => (
                  <td key={c.key} className="py-2 pr-4">
                    <CellValue value={r[c.key]} format={c.format} />
                  </td>
                ))}
              </tr>
            ))}
            {!visible.length && (
              <tr>
                <td colSpan={element.columns.length} className="py-6 text-center text-muted-foreground">
                  No rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {pages > 1 && (
          <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted-foreground">
            <Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Prev
            </Button>
            <span>
              {page + 1} / {pages}
            </span>
            <Button variant="outline" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
