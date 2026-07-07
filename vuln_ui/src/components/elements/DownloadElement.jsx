import { Download, FileText } from "lucide-react";
import { Card, CardContent, Button } from "../ui/primitives.jsx";

export default function DownloadElement({ element }) {
  const { title, file_name, url, format, record_count, description } = element;
  return (
    <Card>
      <CardContent className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <FileText className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{title || file_name}</p>
          <p className="text-xs text-muted-foreground truncate">
            {file_name}
            {format ? ` · ${format.toUpperCase()}` : ""}
            {record_count != null ? ` · ${record_count.toLocaleString()} records` : ""}
            {description ? ` · ${description}` : ""}
          </p>
        </div>
        <Button onClick={() => window.open(url, "_blank")}>
          <Download className="h-4 w-4" /> Download
        </Button>
      </CardContent>
    </Card>
  );
}
