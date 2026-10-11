import { useEffect, useState } from "react";
import { Check, Play, Star } from "lucide-react";

import { Poster, ProgressBar } from "@/components/Poster";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, imageUrl, library, type Metadata } from "@/lib/api";
import { formatDuration, isWatched, progress, resolutionLabel } from "@/lib/format";
import { useNav } from "@/lib/nav";

export function ItemView({ ratingKey }: { ratingKey: string }) {
  const [item, setItem] = useState<Metadata | null>(null);
  const [children, setChildren] = useState<Metadata[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const m = await library.metadata(ratingKey);
        if (!live) return;
        setItem(m);
        if (m.type === "show" || m.type === "season") {
          const kids = await library.children(ratingKey);
          if (live) setChildren(kids);
        }
      } catch (e) {
        if (live) setError(errorMessage(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [ratingKey]);

  if (error) return <p className="text-destructive p-8 text-sm">{error}</p>;
  if (!item) return <HeroSkeleton />;

  return (
    <div className="h-full overflow-y-auto">
      <Hero item={item} />
      <div className="flex flex-col gap-10 px-8 pb-12">
        {item.type === "show" && <Seasons seasons={children} />}
        {item.type === "season" && <Episodes episodes={children} />}
        {item.Role.length > 0 && <Cast item={item} />}
      </div>
    </div>
  );
}

function Hero({ item }: { item: Metadata }) {
  const { server, navigate } = useNav();
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
          <div className={`bg-card overflow-hidden rounded-2xl border shadow-2xl ${wide ? "aspect-video" : "aspect-[2/3]"}`}>
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
              onClick={() => item.grandparentRatingKey && navigate({ name: "item", ratingKey: item.grandparentRatingKey })}
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
          {item.summary && <p className="text-muted-foreground line-clamp-4 max-w-3xl text-sm leading-relaxed">{item.summary}</p>}
          {(item.type === "movie" || item.type === "episode") && (
            <div className="flex items-center gap-3">
              <Button size="lg" disabled title="The player arrives in the next update">
                <Play className="fill-current" /> {resumable ? "Resume" : "Play"}
              </Button>
              {resumable && (
                <div className="bg-muted relative h-1.5 w-40 overflow-hidden rounded-full">
                  <div className="bg-primary h-full" style={{ width: `${progress(item) * 100}%` }} />
                </div>
              )}
            </div>
          )}
          {item.Director.length > 0 && (
            <p className="text-muted-foreground text-sm">Directed by {item.Director.map((d) => d.tag).join(", ")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Seasons({ seasons }: { seasons: Metadata[] | null }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Seasons</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-5">
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
      {episodes === null &&
        Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      {episodes?.map((e) => (
        <button
          key={e.ratingKey}
          onClick={() => navigate({ name: "item", ratingKey: e.ratingKey })}
          className="hover:bg-card group flex gap-5 rounded-xl p-2 text-left transition-colors"
        >
          <div className="bg-card relative aspect-video w-56 shrink-0 overflow-hidden rounded-lg border">
            {e.thumb && (
              <img src={imageUrl(server, e.thumb, 224, 126)} alt="" loading="lazy" className="size-full object-cover" />
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
      ))}
    </section>
  );
}

function Cast({ item }: { item: Metadata }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Cast</h2>
      <div className="-mx-2 flex gap-5 overflow-x-auto px-2 pb-2 [scrollbar-width:none]">
        {item.Role.slice(0, 20).map((r) => (
          <div key={`${r.tag}-${r.role}`} className="flex w-24 shrink-0 flex-col items-center gap-2 text-center">
            <Avatar className="size-20">
              {r.thumb && <AvatarImage src={r.thumb} alt={r.tag} className="object-cover" />}
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
