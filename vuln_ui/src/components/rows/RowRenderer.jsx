// Renders DisplayPayload rows on a 12-column grid.
// span 0 = split the row evenly among its items.
import { ELEMENT_REGISTRY } from "../elements/registry.js";
import { Card, CardContent } from "../ui/primitives.jsx";

function UnknownElement({ element }) {
  return (
    <Card>
      <CardContent className="text-xs text-muted-foreground">
        Unsupported element type: <code>{element.type}</code>
      </CardContent>
    </Card>
  );
}

export default function RowRenderer({ rows, onApplyFilters }) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, ri) => {
        const autoSpan = Math.max(1, Math.floor(12 / row.items.length));
        return (
          <div key={row.id || ri} className="grid grid-cols-12 gap-3">
            {row.items.map((item, ii) => {
              const El = ELEMENT_REGISTRY[item.element.type] || UnknownElement;
              const span = item.span > 0 ? item.span : autoSpan;
              return (
                <div key={ii} style={{ gridColumn: `span ${span} / span ${span}` }}>
                  <El element={item.element} onApplyFilters={onApplyFilters} />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
