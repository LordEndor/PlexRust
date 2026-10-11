import { useEffect, useState } from "react";
import { Check, ListVideo, Play } from "lucide-react";

import { ItemContextMenu } from "@/components/ItemMenu";
import { Poster, ProgressBar } from "@/components/Poster";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, imageUrl, library, type Metadata } from "@/lib/api";
import { useLibraryChanged } from "@/lib/changes";
import { episodeLabel, formatDuration, isWatched, progress } from "@/lib/format";
import { useNav } from "@/lib/nav";
import { posterSize, usePrefs } from "@/lib/prefs";

/** Every video playlist on the server. */
export function PlaylistsView() {
  const [playlists, setPlaylists] = useState<Metadata[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prefs = usePrefs();

  const load = () =>
    library
      .playlists()
      .then((p) => {
        setPlaylists(p);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e)));
  useEffect(() => {
    load();
  }, []);
  useLibraryChanged(load);

  return (
    <div className="h-full overflow-y-auto px-8 pb-8">
      <header className="bg-background/95 sticky top-0 z-10 -mx-8 mb-4 flex items-center gap-3 px-8 py-4 backdrop-blur">
        <h1 className="flex-1 text-2xl font-semibold">
          Playlists
          {playlists && (
            <span className="text-muted-foreground ml-3 text-sm font-normal">
              {playlists.length} playlist{playlists.length === 1 ? "" : "s"}
            </span>
          )}
        </h1>
      </header>
      {error && <p className="text-destructive mb-4 text-sm">{error}</p>}
      {playlists?.length === 0 && (
        <p className="text-muted-foreground py-16 text-center text-sm">
          No video playlists yet. Playlists made in Plex show up here.
        </p>
      )}
      <div
        className="grid gap-5"
        style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${posterSize(prefs).poster}px,1fr))` }}
      >
        {playlists === null && !error
          ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="aspect-[2/3] rounded-xl" />)
          : playlists?.map((p) => <Poster key={p.ratingKey} item={p} />)}
      </div>
    </div>
  );
}

/** One playlist: what's in it, in order, and a Play button that plays it through. */
export function PlaylistView({ ratingKey }: { ratingKey: string }) {
  const { server, navigate } = useNav();
  const [playlist, setPlaylist] = useState<Metadata | null>(null);
  const [items, setItems] = useState<Metadata[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useLibraryChanged(() => setVersion((v) => v + 1));

  useEffect(() => {
    let live = true;
    Promise.all([library.playlist(ratingKey), library.playlistItems(ratingKey)])
      .then(([p, i]) => {
        if (!live) return;
        setPlaylist(p);
        setItems(i);
      })
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [ratingKey, version]);

  const play = (item: Metadata, fromStart = false) =>
    navigate({ name: "player", ratingKey: item.ratingKey, resume: !fromStart && progress(item) > 0, playlist: ratingKey });

  if (error) return <p className="text-destructive p-8 text-sm">{error}</p>;

  const cover = playlist?.composite ?? playlist?.thumb;
  const first = items?.find((m) => !isWatched(m)) ?? items?.[0];
  const meta = [
    items ? `${items.length} item${items.length === 1 ? "" : "s"}` : null,
    formatDuration(playlist?.duration ?? items?.reduce((n, m) => n + (m.duration ?? 0), 0)),
  ].filter(Boolean);

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex gap-8 px-8 pt-12 pb-8">
        <div className="bg-card grid aspect-square w-48 shrink-0 place-items-center overflow-hidden rounded-2xl border shadow-2xl">
          {cover ? (
            <img src={imageUrl(server, cover, 192, 192)} alt="" className="size-full object-cover" />
          ) : (
            <ListVideo className="text-muted-foreground size-12" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-end gap-4">
          <p className="text-muted-foreground text-sm font-medium">Playlist</p>
          {playlist ? (
            <h1 className="text-4xl font-bold tracking-tight">{playlist.title}</h1>
          ) : (
            <Skeleton className="h-10 w-2/3" />
          )}
          <div className="text-muted-foreground flex gap-3 text-sm">
            {meta.map((m) => (
              <span key={m}>{m}</span>
            ))}
          </div>
          {playlist?.summary && (
            <p className="text-muted-foreground line-clamp-3 max-w-3xl text-sm leading-relaxed">{playlist.summary}</p>
          )}
          {first && (
            <div>
              <Button size="lg" onClick={() => play(first)}>
                <Play className="fill-current" />
                {first === items?.[0] && progress(first) === 0 ? "Play" : `${progress(first) > 0 ? "Resume" : "Play"} ${first.title}`}
              </Button>
            </div>
          )}
        </div>
      </div>

      <section className="flex flex-col gap-1 px-8 pb-12">
        {items === null && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        {items?.length === 0 && <p className="text-muted-foreground py-8 text-sm">This playlist is empty.</p>}
        {items?.map((m, i) => (
          <PlaylistRow key={`${m.ratingKey}-${i}`} item={m} position={i + 1} onPlay={() => play(m)} />
        ))}
      </section>
    </div>
  );
}

function PlaylistRow({ item, position, onPlay }: { item: Metadata; position: number; onPlay: () => void }) {
  const { server, navigate } = useNav();
  const episode = item.type === "episode";
  const thumb = episode ? (item.thumb ?? item.grandparentArt) : (item.art ?? item.thumb);
  const heading = episode ? item.grandparentTitle : item.title;
  const sub = episode
    ? `${episodeLabel(item)} · ${item.title}`
    : [item.year, formatDuration(item.duration)].filter(Boolean).join(" · ");

  return (
    <ItemContextMenu item={item}>
      <div className="hover:bg-card group flex items-center gap-4 rounded-xl p-2 transition-colors">
        <span className="text-muted-foreground w-6 shrink-0 text-right text-sm tabular-nums">{position}</span>
        <button
          onClick={onPlay}
          title={`Play ${item.title}`}
          className="bg-card relative aspect-video w-44 shrink-0 overflow-hidden rounded-lg border outline-none"
        >
          {thumb && (
            <img src={imageUrl(server, thumb, 176, 99)} alt="" loading="lazy" className="size-full object-cover" />
          )}
          <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <Play className="size-7 fill-white text-white" />
          </span>
          {isWatched(item) && (
            <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-black/70">
              <Check className="size-3.5" />
            </span>
          )}
          <ProgressBar value={progress(item)} />
        </button>
        <button
          onClick={() => navigate({ name: "item", ratingKey: item.ratingKey })}
          className="flex min-w-0 flex-1 flex-col gap-1 py-1 text-left"
        >
          <span className="truncate font-medium">{heading}</span>
          <span className="text-muted-foreground truncate text-sm">{sub}</span>
          {item.summary && <span className="text-muted-foreground line-clamp-1 text-xs">{item.summary}</span>}
        </button>
        {episode && (
          <span className="text-muted-foreground shrink-0 text-sm">{formatDuration(item.duration)}</span>
        )}
      </div>
    </ItemContextMenu>
  );
}
