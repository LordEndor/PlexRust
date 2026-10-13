import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Play, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { library, type Metadata } from "@/lib/api";
import { mediaName, type DownloadMedia, type Snapshot } from "@/lib/downloads";
import { useNav } from "@/lib/nav";

/** How long after a download finishes Plex gets to show it before giving up. */
const FIND_FOR_MS = 15 * 60_000;
const MAX_TOASTS = 3;

interface Watched {
  media: DownloadMedia;
  /** The last progress seen, so a download deleted halfway is dropped. */
  progress: number;
  /** When it was first seen finished. */
  finishedAt?: number;
}

interface Toast {
  id: string;
  name: string;
  poster?: string | null;
  /** What the button opens; missing when Plex hasn't got it yet. */
  ratingKey?: string;
  /** A movie or one episode, which Play starts; a season opens its page. */
  playable: boolean;
}

function hasId(m: Metadata, scheme: string, id: number | null | undefined) {
  return id != null && (m.Guid ?? []).some((g) => g.id === `${scheme}://${id}`);
}

/** The movie or episode in Plex, matched by TMDB or TVDB id. */
async function findInPlex(media: DownloadMedia): Promise<string | undefined> {
  const hubs = await library.search(media.title);
  const type = media.kind === "movie" ? "movie" : "show";
  const candidates = hubs.flatMap((h) => h.Metadata ?? []).filter((m) => m.type === type).slice(0, 5);
  for (const c of candidates) {
    const full = await library.metadata(c.ratingKey).catch(() => null);
    if (!full) continue;
    const same =
      hasId(full, "tmdb", media.tmdbId) ||
      hasId(full, "tvdb", media.tvdbId) ||
      (full.title.toLowerCase() === media.title.toLowerCase() && (!media.year || full.year === media.year));
    if (!same) continue;
    if (media.kind === "movie") return full.ratingKey;
    const seasons = await library.children(full.ratingKey);
    const season = seasons.find((s) => s.index === media.seasonNumber);
    if (!season) return undefined;
    if (media.episodes.length !== 1) return season.ratingKey;
    const episodes = await library.children(season.ratingKey);
    return episodes.find((e) => e.index === media.episodes[0])?.ratingKey;
  }
  return undefined;
}

/**
 * Watches the downloads Radarr and Sonarr asked for and, once one has been
 * imported and shows up in Plex, says it's ready with a Play button.
 */
export function ReadyToasts({
  snapshot,
  enabled,
  hidden,
}: {
  snapshot: Snapshot | null;
  enabled: boolean;
  /** While a video plays; toasts wait until it closes. */
  hidden?: boolean;
}) {
  const { navigate } = useNav();
  const watched = useRef(new Map<string, Watched>());
  const looking = useRef(new Set<string>());
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    if (!snapshot || !enabled) return;
    const now = Date.now();
    const show = (t: Toast) => setToasts((all) => [t, ...all.filter((a) => a.id !== t.id)].slice(0, MAX_TOASTS));

    for (const t of snapshot.torrents) {
      const media = snapshot.media[t.hash];
      // Only downloads seen unfinished while the app runs, so nothing old pops up at launch.
      if (media && t.progress < 1 && !watched.current.has(t.hash)) watched.current.set(t.hash, { media, progress: t.progress });
    }

    for (const [hash, w] of watched.current) {
      const torrent = snapshot.torrents.find((t) => t.hash === hash);
      const media = snapshot.media[hash] ?? w.media;
      w.media = media;
      if (torrent) w.progress = torrent.progress;
      if (!torrent && w.progress < 1) {
        watched.current.delete(hash);
        continue;
      }
      if (w.progress < 1) continue;
      w.finishedAt ??= now;
      // Still in the queue and not imported yet: Plex can't have it.
      const inQueue = !!snapshot.media[hash];
      if (inQueue && media.state !== "imported") continue;
      if (looking.current.has(hash)) continue;
      looking.current.add(hash);
      findInPlex(media)
        .catch(() => undefined)
        .then((ratingKey) => {
          looking.current.delete(hash);
          if (!watched.current.has(hash)) return;
          if (ratingKey || now - (w.finishedAt ?? now) > FIND_FOR_MS) {
            watched.current.delete(hash);
            const playable = media.kind === "movie" || media.episodes.length === 1;
            show({ id: hash, name: mediaName(media), poster: media.poster, ratingKey, playable });
          }
        });
    }
  }, [snapshot, enabled]);

  if (toasts.length === 0 || hidden) return null;
  const close = (id: string) => setToasts((all) => all.filter((t) => t.id !== id));

  return (
    <div className="fixed right-6 bottom-6 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} role="status" className="bg-popover flex gap-3 rounded-xl border p-3 shadow-2xl">
          <div className="bg-muted aspect-[2/3] w-12 shrink-0 overflow-hidden rounded-md border">
            {t.poster && <img src={t.poster} alt="" className="size-full object-cover" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-xs font-medium text-emerald-400">
              <CheckCircle2 className="size-3.5" /> {t.ratingKey ? "Ready to watch" : "Finished downloading"}
            </div>
            <div className="mt-0.5 truncate text-sm font-semibold" title={t.name}>
              {t.name}
            </div>
            {t.ratingKey ? (
              <Button
                size="sm"
                className="mt-2 h-7"
                onClick={() => {
                  close(t.id);
                  navigate(
                    t.playable
                      ? { name: "player", ratingKey: t.ratingKey!, resume: true }
                      : { name: "item", ratingKey: t.ratingKey! },
                  );
                }}
              >
                <Play /> {t.playable ? "Play" : "Open"}
              </Button>
            ) : (
              <div className="text-muted-foreground mt-1 text-xs">Plex hasn't added it yet.</div>
            )}
          </div>
          <button
            className="text-muted-foreground hover:text-foreground self-start rounded-md p-1"
            title="Dismiss"
            onClick={() => close(t.id)}
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
