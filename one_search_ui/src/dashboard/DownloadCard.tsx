import type { DownloadSpec } from "./types";

export function DownloadCard({ spec }: { spec: DownloadSpec }) {
  const { title, fileName, downloadUrl, recordCount } = spec;

  return (
    <div className="osa-download-card">
      <div className="osa-download-icon">⬇</div>
      <div className="osa-download-info">
        <div className="osa-download-title">{title ?? "Download Report"}</div>
        <div className="osa-download-meta">
          {fileName}
          {typeof recordCount === "number" ? ` · ${recordCount.toLocaleString()} rows` : ""}
        </div>
      </div>
      {downloadUrl && (
        <a className="osa-btn primary" href={downloadUrl} target="_blank" rel="noopener noreferrer">
          Download
        </a>
      )}
    </div>
  );
}
