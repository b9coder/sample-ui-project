import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { UIComponent, UIData } from "../types";
import { resolveDataRef } from "../resolveDataRef";

// The resolved dataRef is the MCP tool's raw export object VERBATIM
// (file_name/download_url/record_count) - rendered as-is, only the
// prop names differ (presentation), no value is altered.
export function DownloadElement({ component, data }: { component: UIComponent; data: UIData }) {
  const resolved = resolveDataRef(data, component.dataRef) as
    | { file_name?: string; download_url?: string | null; record_count?: number }
    | undefined;
  if (!resolved?.download_url) return null;

  return (
    <Card className="py-4">
      <CardContent className="flex items-center gap-4 px-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Download className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">
            {component.title ?? "Download Vulnerability Report"}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {resolved.file_name ?? "vulnerabilities.csv"}
            {typeof resolved.record_count === "number"
              ? ` · ${resolved.record_count.toLocaleString()} rows`
              : ""}
          </div>
        </div>
        <Button asChild size="sm">
          <a href={resolved.download_url} target="_blank" rel="noopener noreferrer">
            <Download className="h-4 w-4" />
            Download
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
