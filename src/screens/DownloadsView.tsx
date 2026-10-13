import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  HardDrive,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  RefreshCw,
  Rocket,
  Trash2,
  Turtle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import {
  formatBytes,
  formatEta,
  formatSpeed,
  qbit,
  STATE_CLASS,
  STATE_LABELS,
  useDownloads,
  mediaSubtitle,
  type DownloadAction,
  type DownloadMedia,
  type Torrent,
} from "@/lib/downloads";
import { cn } from "@/lib/utils";

type Tab = "active" | "completed" | "all";

const TAB_KEY = "plexrust.downloadsTab";
const ALL_CATEGORIES = "\u0000all";
const NO_CATEGORY = "";
const REFRESH_MS = 2000;

function readTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return t === "completed" || t === "all" ? t : "active";
  } catch {
    return "active";
  }
}

function inTab(t: Torrent, tab: Tab) {
  if (tab === "all") return true;
  const done = t.progress >= 1 || t.state === "seeding" || t.state === "completed";
  return tab === "completed" ? done : !done;
}

export function DownloadsView() {
  const { snapshot, error, refresh } = useDownloads(true, REFRESH_MS);
  const [tab, setTabState] = useState<Tab>(readTab);
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [deleting, setDeleting] = useState<Torrent | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function setTab(t: Tab) {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // Not remembered.
    }
  }

  async function act(action: DownloadAction, t: Torrent) {
    setActionError(null);
    try {
      await qbit.act(action, [t.hash]);
      refresh();
    } catch (e) {
      setActionError(errorMessage(e));
    }
  }

  async function toggleTurtle() {
    setActionError(null);
    try {
      await qbit.toggleAltSpeed();
      refresh();
    } catch (e) {
      setActionError(errorMessage(e));
    }
  }

  const torrents = snapshot?.torrents ?? [];
  const shown = useMemo(
    () => torrents.filter((t) => inTab(t, tab) && (category === ALL_CATEGORIES || t.category === category)),
    [torrents, tab, category],
  );
  const counts = useMemo(
    () => ({
      active: torrents.filter((t) => inTab(t, "active")).length,
      completed: torrents.filter((t) => inTab(t, "completed")).length,
    }),
    [torrents],
  );
  const categories = useMemo(() => {
    const names = new Set(snapshot?.categories ?? []);
    for (const t of torrents) names.add(t.category);
    return [...names].sort((a, b) => (a === NO_CATEGORY ? 1 : b === NO_CATEGORY ? -1 : a.localeCompare(b)));
  }, [snapshot, torrents]);
  const transfer = snapshot?.transfer;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 p-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-2xl font-semibold">Downloads</h1>
          {transfer && (
            <div className="text-muted-foreground flex items-center gap-4 text-sm tabular-nums">
              <span className="flex items-center gap-1" title="Download speed">
                <ArrowDown className="size-4 text-sky-400" /> {formatSpeed(transfer.dlSpeed)}
              </span>
              <span className="flex items-center gap-1" title="Upload speed">
                <ArrowUp className="size-4 text-emerald-400" /> {formatSpeed(transfer.upSpeed)}
              </span>
              {transfer.freeSpace != null && (
                <span className="flex items-center gap-1" title="Free space where qBittorrent saves">
                  <HardDrive className="size-4" /> {formatBytes(transfer.freeSpace)} free
                </span>
              )}
            </div>
          )}
          {transfer && (
            <Button
              variant={transfer.altSpeed ? "secondary" : "outline"}
              size="sm"
              aria-pressed={transfer.altSpeed}
              onClick={toggleTurtle}
              title={
                transfer.altSpeed
                  ? "Alternative speed limits are on. Click to go back to the normal limits."
                  : "Switch to qBittorrent's alternative speed limits"
              }
            >
              <Turtle /> {transfer.altSpeed ? "Slow mode on" : "Slow mode"}
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "active", label: counts.active ? `Active · ${counts.active}` : "Active" },
              { value: "completed", label: counts.completed ? `Completed · ${counts.completed}` : "Completed" },
              { value: "all", label: "All" },
            ]}
          />
          {categories.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  {category === ALL_CATEGORIES ? "All categories" : category || "No category"}
                  <ChevronDown className="text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-44">
                <DropdownMenuCheckItem checked={category === ALL_CATEGORIES} onSelect={() => setCategory(ALL_CATEGORIES)}>
                  All categories
                </DropdownMenuCheckItem>
                <DropdownMenuSeparator />
                {categories.map((c) => (
                  <DropdownMenuCheckItem key={c} checked={category === c} onSelect={() => setCategory(c)}>
                    {c || "No category"}
                  </DropdownMenuCheckItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {(error || actionError) && (
          <p className="text-destructive text-sm">
            {actionError ?? `Couldn't reach qBittorrent: ${error}`}
            {error && snapshot && " Showing the last list it sent."}
          </p>
        )}

        {!snapshot && !error ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        ) : shown.length === 0 && snapshot ? (
          <div className="text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
            {tab === "active" ? "Nothing is downloading right now." : tab === "completed" ? "No finished downloads." : "qBittorrent has no torrents."}
          </div>
        ) : (
          <div className="bg-card divide-y rounded-xl border">
            {shown.map((t) => (
              <TorrentRow key={t.hash} torrent={t} media={snapshot?.media[t.hash]} onAction={(a) => act(a, t)} onDelete={() => setDeleting(t)} />
            ))}
          </div>
        )}
      </div>

      {deleting && (
        <DeleteDialog
          torrent={deleting}
          onClose={() => setDeleting(null)}
          onDelete={async (withFiles) => {
            await act(withFiles ? "deleteWithFiles" : "delete", deleting);
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}

function TorrentRow({
  torrent: t,
  media,
  onAction,
  onDelete,
}: {
  torrent: Torrent;
  /** The movie or episodes, when Radarr or Sonarr fetches this. */
  media?: DownloadMedia;
  onAction: (action: DownloadAction) => void;
  onDelete: () => void;
}) {
  const stopped = t.state === "paused" || t.state === "completed";
  const done = t.progress >= 1;
  const details = [
    done ? formatBytes(t.size) : `${formatBytes(t.downloaded)} of ${formatBytes(t.size)}`,
    t.dlSpeed > 0 && `↓ ${formatSpeed(t.dlSpeed)}`,
    t.upSpeed > 0 && `↑ ${formatSpeed(t.upSpeed)}`,
    !done && t.eta != null && t.dlSpeed > 0 && `${formatEta(t.eta)} left`,
    !done && `${t.seeds} seed${t.seeds === 1 ? "" : "s"} · ${t.peers} peer${t.peers === 1 ? "" : "s"}`,
    done && `Ratio ${t.ratio.toFixed(2)}`,
  ].filter(Boolean);

  const items = (
    Item: typeof ContextMenuItem | typeof DropdownMenuItem,
    Separator: typeof ContextMenuSeparator | typeof DropdownMenuSeparator,
  ) => (
    <>
      {stopped ? (
        <Item onSelect={() => onAction("resume")}>
          <Play /> Resume
        </Item>
      ) : (
        <Item onSelect={() => onAction("pause")}>
          <Pause /> Pause
        </Item>
      )}
      {!done && !t.forceStart && (
        <Item onSelect={() => onAction("forceStart")}>
          <Rocket /> Force start
        </Item>
      )}
      <Item onSelect={() => onAction("recheck")}>
        <RefreshCw /> Check files again
      </Item>
      <Separator />
      <Item onSelect={onDelete} className="text-destructive focus:text-destructive">
        <Trash2 /> Delete…
      </Item>
    </>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex items-center gap-4 px-5 py-4">
          {media && (
            <div className="bg-muted aspect-[2/3] w-11 shrink-0 self-start overflow-hidden rounded-md border">
              {media.poster && <img src={media.poster} alt="" loading="lazy" className="size-full object-cover" />}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium" title={t.name}>
                {media ? media.title : t.name}
              </span>
              {media && <span className="text-muted-foreground shrink-0 truncate text-sm">{mediaSubtitle(media)}</span>}
              <span className={cn("shrink-0 rounded-md border px-1.5 py-0.5 text-xs", STATE_CLASS[t.state])} title={t.rawState}>
                {t.forceStart && t.state === "downloading" ? "Forced" : STATE_LABELS[t.state]}
              </span>
              {t.category && <span className="text-muted-foreground shrink-0 text-xs">{t.category}</span>}
            </div>
            {media && (
              <div className="text-muted-foreground mt-0.5 truncate text-xs" title={t.name}>
                {t.name}
              </div>
            )}
            <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-500",
                  t.state === "error" ? "bg-red-500" : done ? "bg-emerald-500" : stopped ? "bg-muted-foreground" : "bg-primary",
                )}
                style={{ width: `${(t.progress * 100).toFixed(1)}%` }}
              />
            </div>
            <div className="text-muted-foreground mt-1.5 flex flex-wrap gap-x-3 text-xs tabular-nums">
              <span className="text-foreground/80">{(t.progress * 100).toFixed(t.progress < 1 ? 1 : 0)}%</span>
              {details.map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              title={stopped ? "Resume" : "Pause"}
              onClick={() => onAction(stopped ? "resume" : "pause")}
            >
              {stopped ? <Play /> : <Pause />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" title="More">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                {items(DropdownMenuItem, DropdownMenuSeparator)}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-48">{items(ContextMenuItem, ContextMenuSeparator)}</ContextMenuContent>
    </ContextMenu>
  );
}

function DeleteDialog({
  torrent,
  onClose,
  onDelete,
}: {
  torrent: Torrent;
  onClose: () => void;
  onDelete: (withFiles: boolean) => Promise<void>;
}) {
  const [withFiles, setWithFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(30rem,calc(100vw-2rem))] gap-4 p-6">
        <DialogTitle>Delete this torrent?</DialogTitle>
        <DialogDescription className="break-all">{torrent.name}</DialogDescription>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={withFiles}
            onChange={(e) => setWithFiles(e.target.checked)}
            className="accent-primary mt-0.5 size-4"
          />
          <span>
            Also delete the downloaded files
            <span className="text-muted-foreground block">
              {withFiles
                ? "The files are removed from disk. If Plex already has them, they disappear from your library too."
                : "The files stay on disk, so anything Plex already has keeps playing."}
            </span>
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onDelete(withFiles);
              setBusy(false);
            }}
          >
            {busy && <Loader2 className="animate-spin" />}
            {withFiles ? "Delete with files" : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

