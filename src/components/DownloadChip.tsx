import { Download } from "lucide-react";

import { downloadProgress, formatEta, useDownloadsSnapshot, type DownloadMatch } from "@/lib/downloads";
import { cn } from "@/lib/utils";

/** "Downloading 62% · 14 min" when qBittorrent is fetching this title; nothing otherwise. */
export function DownloadChip({ match, compact, className }: { match: DownloadMatch; compact?: boolean; className?: string }) {
  const p = downloadProgress(useDownloadsSnapshot(), match);
  if (!p) return null;
  const pct = `${Math.floor(p.progress * 100)}%`;
  const when = p.stalled ? "stalled" : p.eta != null ? formatEta(p.eta) : null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/15 px-1.5 py-0.5 text-xs font-semibold text-sky-300 tabular-nums",
        className,
      )}
      title={`Downloading, ${pct} done${when ? `, ${when === "stalled" ? "stalled" : `${when} left`}` : ""}`}
    >
      <Download className="size-3" />
      {compact ? pct : `Downloading ${pct}${when ? ` · ${when}` : ""}`}
    </span>
  );
}
