import { useEffect, useState } from "react";
import { Check, Clapperboard, Ellipsis, Play, RotateCcw, Star } from "lucide-react";

import { InfoDialog } from "@/components/InfoDialog";
import { ItemContextMenu, itemActions } from "@/components/ItemMenu";
import { Poster, ProgressBar } from "@/components/Poster";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, imageUrl, library, type Metadata } from "@/lib/api";
import { useLibraryChanged } from "@/lib/changes";
import { episodeLabel, formatDuration, isWatched, progress, resolutionLabel } from "@/lib/format";
import { useNav } from "@/lib/nav";
import { formatTime } from "@/lib/player";
import { posterSize, usePrefs } from "@/lib/prefs";
import { PlaylistView } from "@/screens/PlaylistView";

export function ItemView({ ratingKey }: { ratingKey: string }) {
  const [item, setItem] = useState<Metadata | null>(null);
  const [children, setChildren] = useState<Metadata[] | null>(null);
  const [trailer, setTrailer] = useState<Metadata | null>(null);
  const [upNext, setUpNext] = useState<Metadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped when watched state changes elsewhere, to load the page again.
  const [version, setVersion] = useState(0);
  useLibraryChanged(() => setVersion((v) => v + 1));

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const m = await library.metadata(ratingKey);
        if (!live) return;
        setItem(m);
        if (m.type === "show" || m.type === "season") {
          library
            .upNext(ratingKey)
            .then((e) => live && setUpNext(e))
            .catch(() => live && setUpNext(null));
        }
        if (version === 0 && (m.type === "movie" || m.type === "show")) {
          // Trailers are a bonus: no button if they can't be listed.
          library
            .trailers(ratingKey)
            .then((t) => live && setTrailer(t[0] ?? null))
            .catch(() => {});
        }
        if (m.type === "show" || m.type === "season" || m.type === "collection") {
          const kids = await (m.type === "collection"
            ? library.collectionItems(ratingKey)
            : library.children(ratingKey));
          if (live) setChildren(kids);
        }
      } catch (e) {
        if (live) setError(errorMessage(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [ratingKey, version]);

  if (error) return <p className="text-destructive p-8 text-sm">{error}</p>;
  if (!item) return <HeroSkeleton />;
  if (item.type === "playlist") return <PlaylistView ratingKey={ratingKey} />;

  return (
    <div className="h-full overflow-y-auto">
      <Hero item={item} trailer={trailer} upNext={upNext} />
      <div className="relative flex flex-col gap-10 px-8 pb-12">
        {item.type === "show" && <Seasons seasons={children} />}
        {item.type === "season" && <Episodes episodes={children} />}
        {item.type === "collection" && <Seasons seasons={children} title="In this collection" />}
        {item.Role.length > 0 && <Cast item={item} />}
      </div>
    </div>
  );
}

function Hero({ item, trailer, upNext }: { item: Metadata; trailer: Metadata | null; upNext: Metadata | null }) {
  const nav = useNav();
  const { server, navigate } = nav;
  const [info, setInfo] = useState(false);
  const actions = itemActions(item, nav, { onInfo: () => setInfo(true) }).filter(
    (a) => a.label !== "Play" && a.label !== "Resume",
  );
  // What the Play button starts: the item itself, or a show's next episode.
  const target = item.type === "movie" || item.type === "episode" ? item : upNext;
  const targetResumable = !!target && progress(target) > 0;
  const art = item.art ?? item.grandparentArt;
  const poster = item.type === "episode" ? item.thumb : (item.thumb ?? item.parentThumb);
  const wide = item.type === "episode";
  const resumable = progress(item) > 0;
  const rating = item.audienceRating ?? item.rating;

  const meta = [
    item.type === "episode" ? `S${item.parentIndex} · E${item.index}` : null,
    item.type === "season" ? item.parentTitle : null,
    item.year,
    item.contentRating,
    formatDuration(item.duration),
    item.type === "show" && item.childCount ? `${item.childCount} seasons` : null,
    item.type === "season" && item.leafCount ? `${item.leafCount} episodes` : null,
    item.type === "collection" && item.childCount ? `${item.childCount} items` : null,
  ].filter(Boolean);

  return (
    <div className="relative">
      {art && (
        <div className="absolute inset-0 h-[520px] overflow-hidden">
          <img src={imageUrl(server, art, 1600, 900)} alt="" className="size-full object-cover opacity-40" />
          <div className="from-background via-background/70 absolute inset-0 bg-gradient-to-t to-transparent" />
          <div className="from-background absolute inset-0 bg-gradient-to-r via-transparent to-transparent" />
        </div>
      )}
      <div className="relative flex gap-8 px-8 pt-16 pb-10">
        <div className={wide ? "w-96 shrink-0" : "w-56 shrink-0"}>
          <div
            className={`bg-card overflow-hidden rounded-2xl border shadow-2xl ${wide ? "aspect-video" : "aspect-[2/3]"}`}
          >
            {poster && (
              <img
                src={imageUrl(server, poster, wide ? 384 : 224, wide ? 216 : 336)}
                alt=""
                className="size-full object-cover"
              />
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-end gap-4">
          {item.type === "episode" && item.grandparentTitle && (
            <button
              className="text-muted-foreground hover:text-foreground w-fit text-sm font-medium"
              onClick={() =>
                item.grandparentRatingKey && navigate({ name: "item", ratingKey: item.grandparentRatingKey })
              }
            >
              {item.grandparentTitle}
            </button>
          )}
          <h1 className="text-4xl font-bold tracking-tight">{item.title}</h1>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {meta.map((m, i) => (
              <span key={i}>{m}</span>
            ))}
            {rating ? (
              <span className="flex items-center gap-1">
                <Star className="fill-primary text-primary size-3.5" /> {rating.toFixed(1)}
              </span>
            ) : null}
            {resolutionLabel(item) && <Badge variant="outline">{resolutionLabel(item)}</Badge>}
            {isWatched(item) && (
              <span className="flex items-center gap-1">
                <Check className="size-3.5" /> Watched
              </span>
            )}
          </div>
          {item.Genre.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {item.Genre.map((g) => (
                <Badge key={g.tag} variant="secondary">
                  {g.tag}
                </Badge>
              ))}
            </div>
          )}
          {item.tagline && <p className="text-lg italic">{item.tagline}</p>}
          {item.summary && (
            <p className="text-muted-foreground line-clamp-4 max-w-3xl text-sm leading-relaxed">{item.summary}</p>
          )}
          <div className="flex items-center gap-3">
            {target && (
              <Button
                size="lg"
                onClick={() =>
                  navigate({
                    name: "player",
                    ratingKey: target.ratingKey,
                    resume: targetResumable,
                  })
                }
              >
                <Play className="fill-current" />
                {target === item
                  ? targetResumable
                    ? `Resume from ${formatTime((item.viewOffset ?? 0) / 1000)}`
                    : "Play"
                  : `${targetResumable ? "Resume" : "Play"} ${episodeLabel(target)}`}
              </Button>
            )}
            {resumable && target === item && (
              <Button
                size="lg"
                variant="secondary"
                onClick={() =>
                  navigate({
                    name: "player",
                    ratingKey: item.ratingKey,
                    resume: false,
                  })
                }
              >
                <RotateCcw /> From the start
              </Button>
            )}
            {trailer && (
              <Button
                size="lg"
                variant="secondary"
                onClick={() =>
                  navigate({
                    name: "player",
                    ratingKey: trailer.ratingKey,
                    resume: false,
                  })
                }
              >
                <Clapperboard /> Trailer
              </Button>
            )}
            {actions.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="secondary" className="size-10" title="More">
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {actions.map((a) => (
                    <div key={a.label}>
                      {a.separated && <DropdownMenuSeparator />}
                      <DropdownMenuCheckItem onSelect={a.run} className="pl-2 [&_svg]:size-4">
                        <a.icon />
                        {a.label}
                      </DropdownMenuCheckItem>
                    </div>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {info && <InfoDialog item={item} open={info} onOpenChange={setInfo} />}
          </div>
          {target && target !== item && (
            <p className="text-muted-foreground -mt-1 text-sm">
              Next up: <span className="text-foreground">{target.title}</span>
            </p>
          )}
          {item.Director.length > 0 && (
            <p className="text-muted-foreground text-sm">Directed by {item.Director.map((d) => d.tag).join(", ")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Seasons({ seasons, title = "Seasons" }: { seasons: Metadata[] | null; title?: string }) {
  const prefs = usePrefs();
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <div
        className="grid gap-5"
        style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${posterSize(prefs).poster - 10}px,1fr))` }}
      >
        {seasons === null
          ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="aspect-[2/3] rounded-xl" />)
          : seasons.map((s) => <Poster key={s.ratingKey} item={s} />)}
      </div>
    </section>
  );
}

function Episodes({ episodes }: { episodes: Metadata[] | null }) {
  const { server, navigate } = useNav();
  return (
    <section className="flex flex-col gap-2">
      <h2 className="mb-1 text-lg font-semibold">Episodes</h2>
      {episodes === null && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      {episodes?.map((e) => (
        <ItemContextMenu key={e.ratingKey} item={e}>
          <button
            onClick={() => navigate({ name: "item", ratingKey: e.ratingKey })}
            className="hover:bg-card group flex gap-5 rounded-xl p-2 text-left transition-colors"
          >
            <div className="bg-card relative aspect-video w-56 shrink-0 overflow-hidden rounded-lg border">
              {e.thumb && (
                <img
                  src={imageUrl(server, e.thumb, 224, 126)}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover"
                />
              )}
              {isWatched(e) && (
                <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-black/70">
                  <Check className="size-3.5" />
                </span>
              )}
              <ProgressBar value={progress(e)} />
            </div>
            <div className="flex min-w-0 flex-col gap-1 py-1">
              <div className="font-medium">
                <span className="text-muted-foreground mr-2">{e.index}</span>
                {e.title}
              </div>
              <div className="text-muted-foreground text-xs">
                {[formatDuration(e.duration), e.originallyAvailableAt].filter(Boolean).join(" · ")}
              </div>
              {e.summary && <p className="text-muted-foreground line-clamp-2 text-sm">{e.summary}</p>}
            </div>
          </button>
        </ItemContextMenu>
      ))}
    </section>
  );
}

function Cast({ item }: { item: Metadata }) {
  const { server } = useNav();
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Cast</h2>
      <div className="-mx-2 flex gap-5 overflow-x-auto px-2 pb-2 [scrollbar-width:none]">
        {item.Role.slice(0, 20).map((r) => (
          <div key={`${r.tag}-${r.role}`} className="flex w-24 shrink-0 flex-col items-center gap-2 text-center">
            <Avatar className="size-20">
              {r.thumb && <AvatarImage src={imageUrl(server, r.thumb, 80, 80)} alt={r.tag} className="object-cover" />}
              <AvatarFallback>{r.tag.slice(0, 1)}</AvatarFallback>
            </Avatar>
            <div className="w-full">
              <div className="truncate text-xs font-medium">{r.tag}</div>
              {r.role && <div className="text-muted-foreground truncate text-xs">{r.role}</div>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HeroSkeleton() {
  return (
    <div className="flex gap-8 px-8 pt-16">
      <Skeleton className="aspect-[2/3] w-56 rounded-2xl" />
      <div className="flex flex-1 flex-col justify-end gap-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-20 w-full max-w-3xl" />
      </div>
    </div>
  );
}
