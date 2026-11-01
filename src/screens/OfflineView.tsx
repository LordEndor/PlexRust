import { useEffect, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { AlertCircle, CloudUpload, FolderOpen, Play, RotateCcw, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { formatBytes } from "@/lib/downloads";
import { useNav } from "@/lib/nav";
import { offline, offlinePoster, useOffline, type OfflineItem } from "@/lib/offline";
import { cn } from "@/lib/utils";

/** Movies and episodes saved on this computer, playable without the server. */
export function OfflineView() {
  const { server } = useNav();
  const items = useOffline();
  const [synced, setSynced] = useState<string | null>(null);

  // Send progress made while offline, now that a server is picked.
  useEffect(() => {
    offline
      .sync()
      .then((n) => n > 0 && setSynced(`Sent watch progress for ${n} item${n === 1 ? "" : "s"} to Plex.`))
      .catch(() => {});
  }, []);

  const here = items?.filter((i) => i.serverId === server.machineId) ?? [];
  const used = here.reduce((n, i) => n + (i.status === "done" ? i.size : i.downloaded), 0);

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-8">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold">Offline</h1>
          <p className="text-muted-foreground text-sm">
            Saved on this computer to watch without the server. {here.length > 0 && `${formatBytes(used)} used.`}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() =>
            offline
              .folder()
              .then((dir) => revealItemInDir(dir))
              .catch(() => {})
          }
        >
          <FolderOpen /> Show folder
        </Button>
      </div>
      {synced && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <CloudUpload className="size-4" /> {synced}
        </p>
      )}
      {items === null && <Skeleton className="h-40 rounded-xl" />}
      {items && here.length === 0 && (
        <p className="text-muted-foreground text-sm">
          Nothing saved yet. Pick “Download for offline” from a movie, episode, season or show's menu.
        </p>
      )}
      <div className="flex flex-col gap-2">
        {here.map((i) => (
          <Row key={i.ratingKey} entry={i} />
        ))}
      </div>
    </div>
  );
}

function Row({ entry }: { entry: OfflineItem }) {
  const { navigate } = useNav();
  const { item, status } = entry;
  const [error, setError] = useState<string | null>(null);
  const pct = entry.size ? Math.min(100, (entry.downloaded / entry.size) * 100) : 0;
  const episode = item.type === "episode";
  const progress = item.duration && entry.viewOffsetMs ? (entry.viewOffsetMs / item.duration) * 100 : 0;

  return (
    <div className="hover:bg-card flex items-center gap-4 rounded-xl p-2 transition-colors">
      <div className="bg-card relative aspect-[2/3] w-14 shrink-0 overflow-hidden rounded-md border">
        {entry.poster && <img src={offlinePoster(entry.poster)} alt="" className="size-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{episode ? item.grandparentTitle : item.title}</div>
        <div className="text-muted-foreground truncate text-sm">
          {episode ? `S${item.parentIndex} · E${item.index} · ${item.title}` : item.year}
          {entry.watched && " · Watched"}
          {entry.pendingSync && " · Progress not sent to Plex yet"}
        </div>
        {status === "downloading" || status === "queued" ? (
          <div className="mt-1.5 flex items-center gap-3">
            <div className="bg-muted h-1.5 max-w-sm flex-1 overflow-hidden rounded-full">
              <div className="bg-primary h-full transition-[width]" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-muted-foreground text-xs tabular-nums">
              {status === "queued" ? "Waiting…" : `${formatBytes(entry.downloaded)} of ${formatBytes(entry.size)}`}
            </span>
          </div>
        ) : status === "failed" ? (
          <div className="text-destructive mt-1 flex items-center gap-1.5 text-xs">
            <AlertCircle className="size-3.5" /> {entry.error ?? "The download failed"}
          </div>
        ) : (
          <div className="text-muted-foreground mt-0.5 flex items-center gap-3 text-xs">
            {formatBytes(entry.size)}
            {progress > 0 && !entry.watched && (
              <span className="bg-muted inline-block h-1 w-24 overflow-hidden rounded-full">
                <span className="bg-primary block h-full" style={{ width: `${progress}%` }} />
              </span>
            )}
          </div>
        )}
        {error && <div className="text-destructive mt-1 text-xs">{error}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {status === "done" && (
          <Button
            size="sm"
            onClick={() => navigate({ name: "player", ratingKey: entry.ratingKey, resume: entry.viewOffsetMs > 0 })}
          >
            <Play className="fill-current" /> {entry.viewOffsetMs > 0 && !entry.watched ? "Resume" : "Play"}
          </Button>
        )}
        {status === "failed" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => offline.download(entry.ratingKey).catch((e) => setError(errorMessage(e)))}
          >
            <RotateCcw /> Retry
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className={cn("size-8")}
          title={status === "done" || status === "failed" ? "Delete from this computer" : "Stop downloading"}
          onClick={() => offline.remove(entry.serverId, entry.ratingKey).catch((e) => setError(errorMessage(e)))}
        >
          {status === "done" || status === "failed" ? <Trash2 /> : <X />}
        </Button>
      </div>
    </div>
  );
}
