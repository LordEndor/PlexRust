import { useCallback, useEffect, useState } from "react";
import { BookmarkX, Compass } from "lucide-react";

import { Poster } from "@/components/Poster";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, imageUrl } from "@/lib/api";
import { useNav } from "@/lib/nav";
import { posterSize, usePrefs } from "@/lib/prefs";
import { useSeerrEnabled } from "@/lib/seerr";
import { useWatchlistChanged, watchlist, type WatchlistItem } from "@/lib/watchlist";

type Show = "all" | "library" | "missing";

/** The Plex watchlist: what's on the server plays, the rest can be requested. */
export function WatchlistView() {
  const prefs = usePrefs();
  const [items, setItems] = useState<WatchlistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<Show>("all");

  const load = useCallback(() => {
    watchlist
      .list()
      .then((i) => {
        setItems(i);
        setError(null);
      })
      .catch((e) => {
        setError(errorMessage(e));
        setItems((prev) => prev ?? []);
      });
  }, []);
  useEffect(load, [load]);
  useWatchlistChanged(load);

  const shown = items?.filter((i) => show === "all" || (show === "library") === !!i.local) ?? [];
  const missing = items?.filter((i) => !i.local).length ?? 0;

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-8">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="mr-auto text-2xl font-semibold">Watchlist</h1>
        <Segmented<Show>
          value={show}
          onChange={setShow}
          options={[
            { value: "all", label: `All${items ? ` ${items.length}` : ""}` },
            { value: "library", label: "In your library" },
            { value: "missing", label: `Not yet${items ? ` ${missing}` : ""}` },
          ]}
        />
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      {items?.length === 0 && !error && (
        <p className="text-muted-foreground text-sm">
          Nothing on your watchlist. Add movies and shows from their page here, or from any Plex app.
        </p>
      )}
      <div
        className="grid gap-5"
        style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${posterSize(prefs).poster - 10}px,1fr))` }}
      >
        {items === null
          ? Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="aspect-[2/3] rounded-xl" />)
          : shown.map((w) => <Entry key={w.item.guid ?? w.item.ratingKey} entry={w} />)}
      </div>
    </div>
  );
}

function Entry({ entry }: { entry: WatchlistItem }) {
  const { server, navigate } = useNav();
  const requests = useSeerrEnabled();
  const { item, local, tmdbId } = entry;
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (!item.guid) return;
    setBusy(true);
    await watchlist.set(item.guid, false).catch(() => setBusy(false));
  };
  const removeButton = item.guid && (
    <button
      title="Remove from watchlist"
      disabled={busy}
      onClick={remove}
      className="absolute top-2 left-2 z-10 grid size-8 place-items-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover/entry:opacity-100 hover:bg-black/90"
    >
      <BookmarkX className="size-4" />
    </button>
  );

  if (local) {
    return (
      <div className="group/entry relative">
        {removeButton}
        <Poster item={local} />
      </div>
    );
  }

  const mediaType = item.type === "show" ? "tv" : "movie";
  return (
    <div className="group/entry relative flex flex-col gap-2">
      {removeButton}
      <div className="bg-card relative aspect-[2/3] overflow-hidden rounded-xl border opacity-80">
        {item.thumb && (
          <img src={imageUrl(server, item.thumb, 300, 450)} alt="" loading="lazy" className="size-full object-cover" />
        )}
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 bg-gradient-to-t from-black/90 to-transparent p-3 pt-10">
          <span className="text-xs text-white/80">Not in your library</span>
          {requests && tmdbId && (
            <Button size="sm" onClick={() => navigate({ name: "request", mediaType, tmdbId })}>
              <Compass /> Request
            </Button>
          )}
        </div>
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{item.title}</div>
        {item.year && <div className="text-muted-foreground text-xs">{item.year}</div>}
      </div>
    </div>
  );
}
