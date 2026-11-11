import { useEffect, useState } from "react";
import { Bookmark, BookmarkCheck, Check, Clapperboard, Ellipsis, Play, RotateCcw, Star } from "lucide-react";

import { InfoDialog } from "@/components/InfoDialog";
import { ItemContextMenu, itemActions } from "@/components/ItemMenu";
import { ManageDialogs } from "@/components/ManageDialogs";
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
import { HubRow } from "@/components/HubRow";
import { errorMessage, imageUrl, library, type Hub, type Metadata, type Tag } from "@/lib/api";
import { useLibraryChanged } from "@/lib/changes";
import { episodeLabel, formatDuration, isWatched, progress, resolutionLabel } from "@/lib/format";
import { useNav } from "@/lib/nav";
import { isUpcoming, releaseLabel, useMissing } from "@/lib/missing";
import { formatTime } from "@/lib/player";
import { posterSize, usePrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import type { ManageDialog } from "@/lib/manage";
import { tmdbImage, type SeerrEpisode, type SeerrSeason } from "@/lib/seerr";
import { canWatchlist, watchlist } from "@/lib/watchlist";
import { PlaylistView } from "@/screens/PlaylistView";

export function ItemView({ ratingKey }: { ratingKey: string }) {
  const [item, setItem] = useState<Metadata | null>(null);
  const [children, setChildren] = useState<Metadata[] | null>(null);
  const [extras, setExtras] = useState<Metadata[]>([]);
  const [related, setRelated] = useState<Hub[]>([]);
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
          // Extras and related titles are a bonus: left out if they can't be listed.
          library
            .extras(ratingKey)
            .then((x) => live && setExtras(x))
            .catch(() => {});
          library
            .related(ratingKey)
            .then((h) => live && setRelated(h))
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

  // A new item starts without the last one's extras and related rows.
  useEffect(() => {
    setExtras([]);
    setRelated([]);
  }, [ratingKey]);

  const prefs = usePrefs();
  // A show with one season lists that season's episodes on its own page.
  const onlySeason =
    item?.type === "show" && prefs?.skipSingleSeason && children?.length === 1 ? children[0] : null;
  const [seasonEpisodes, setSeasonEpisodes] = useState<Metadata[] | null>(null);
  useEffect(() => {
    setSeasonEpisodes(null);
    if (!onlySeason) return;
    let live = true;
    library
      .children(onlySeason.ratingKey)
      .then((e) => live && setSeasonEpisodes(e))
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [onlySeason]);

  const missing = useMissing(item, children, {
    seasons: !!prefs?.missingSeasons,
    episodes: !!prefs?.missingEpisodes,
    season: onlySeason?.index != null ? { index: onlySeason.index, episodes: seasonEpisodes } : null,
  });

  const trailer = extras.find((x) => x.extraType === 1) ?? null;

  if (error) return <p className="text-destructive p-8 text-sm">{error}</p>;
  if (!item) return <HeroSkeleton />;
  if (item.type === "playlist") return <PlaylistView ratingKey={ratingKey} />;

  return (
    <div className="h-full overflow-y-auto">
      <Hero item={item} trailer={trailer} upNext={upNext} />
      <div className="relative flex flex-col gap-10 px-8 pb-12">
        {item.type === "show" &&
          (onlySeason ? (
            <>
              <Episodes
                title={onlySeason.title || "Episodes"}
                episodes={seasonEpisodes}
                missing={missing?.episodes}
                tmdbId={missing?.tmdbId}
              />
              {!!missing?.seasons.length && (
                <Seasons title="More seasons" seasons={[]} missing={missing.seasons} tmdbId={missing.tmdbId} />
              )}
            </>
          ) : (
            <Seasons seasons={children} missing={missing?.seasons} tmdbId={missing?.tmdbId} />
          ))}
        {item.type === "season" && (
          <Episodes episodes={children} missing={missing?.episodes} tmdbId={missing?.tmdbId} />
        )}
        {item.type === "collection" && <Seasons seasons={children} title="In this collection" />}
        {item.Role.length > 0 && <Cast item={item} />}
        {extras.length > 0 && <Extras extras={extras} />}
        {related.map((h) => (
          <HubRow key={h.hubIdentifier || h.title} hub={h} />
        ))}
      </div>
    </div>
  );
}

function Hero({ item, trailer, upNext }: { item: Metadata; trailer: Metadata | null; upNext: Metadata | null }) {
  const nav = useNav();
  const { server, navigate } = nav;
  const [info, setInfo] = useState(false);
  const watchable = canWatchlist(item);
  // null while unknown, so the button doesn't flicker between states.
  const [onList, setOnList] = useState<boolean | null>(null);
  useEffect(() => {
    if (!watchable || !item.guid) return;
    let live = true;
    setOnList(null);
    watchlist
      .has(item.guid)
      .then((v) => live && setOnList(v))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [watchable, item.guid]);
  const toggleWatchlist = () => {
    if (!item.guid || onList === null) return;
    const next = !onList;
    setOnList(next);
    watchlist.set(item.guid, next).catch(() => setOnList(!next));
  };
  const [dialog, setDialog] = useState<ManageDialog | null>(null);
  const actions = itemActions(item, nav, { onInfo: () => setInfo(true), onManage: setDialog }).filter(
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
            {item.type !== "collection" && <StarRating item={item} />}
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
            {watchable && onList !== null && (
              <Button
                size="icon"
                variant="secondary"
                className="size-10"
                title={onList ? "Remove from watchlist" : "Add to watchlist"}
                onClick={toggleWatchlist}
              >
                {onList ? <BookmarkCheck className="text-primary" /> : <Bookmark />}
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
            <ManageDialogs item={item} dialog={dialog} onClose={() => setDialog(null)} leaveOnDelete />
          </div>
          {target && target !== item && (
            <p className="text-muted-foreground -mt-1 text-sm">
              Next up: <span className="text-foreground">{target.title}</span>
            </p>
          )}
          {item.Director.length > 0 && (
            <p className="text-muted-foreground text-sm">
              Directed by <People tags={item.Director} role="director" />
            </p>
          )}
          {item.Writer && item.Writer.length > 0 && (
            <p className="text-muted-foreground -mt-2 text-sm">
              Written by <People tags={item.Writer} role="writer" />
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Seasons({
  seasons,
  title = "Seasons",
  missing = [],
  tmdbId,
}: {
  seasons: Metadata[] | null;
  title?: string;
  /** Seasons the server doesn't have, shown greyed out in order among the others. */
  missing?: SeerrSeason[];
  tmdbId?: number;
}) {
  const prefs = usePrefs();
  const cards =
    seasons === null
      ? []
      : [
          ...seasons.map((s) => ({ index: s.index ?? Infinity, el: <Poster key={s.ratingKey} item={s} /> })),
          ...missing.map((s) => ({
            index: s.seasonNumber,
            el: <MissingSeason key={`missing-${s.seasonNumber}`} season={s} tmdbId={tmdbId} />,
          })),
        ].sort((a, b) => a.index - b.index);
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <div
        className="grid gap-5"
        style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${posterSize(prefs).poster - 10}px,1fr))` }}
      >
        {seasons === null
          ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="aspect-[2/3] rounded-xl" />)
          : cards.map((c) => c.el)}
      </div>
    </section>
  );
}

/** Opens the show's page in Seerr, where what's missing can be requested. */
function requestTarget(tmdbId: number | undefined) {
  return tmdbId ? ({ name: "request", mediaType: "tv", tmdbId } as const) : null;
}

function MissingSeason({ season, tmdbId }: { season: SeerrSeason; tmdbId?: number }) {
  const { navigate } = useNav();
  const target = requestTarget(tmdbId);
  const poster = tmdbImage(season.posterPath, "w342");
  const upcoming = isUpcoming(season.airDate);
  return (
    <button
      onClick={() => target && navigate(target)}
      title={target ? "Not on your server. Open it in Requests." : "Not on your server"}
      className="group flex w-full flex-col gap-2 text-left outline-none"
    >
      <div className="bg-card relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-dashed transition-all group-hover:ring-2 group-hover:ring-muted-foreground/40">
        {poster ? (
          <img src={poster} alt="" loading="lazy" className="size-full object-cover opacity-35 grayscale" />
        ) : (
          <div className="text-muted-foreground grid size-full place-items-center p-3 text-center text-sm">
            {season.name}
          </div>
        )}
        <span className="absolute top-2 left-2 rounded-md bg-black/75 px-1.5 py-0.5 text-xs font-medium text-white/80">
          {upcoming ? "Upcoming" : "Missing"}
        </span>
      </div>
      <div className="min-w-0 px-0.5 opacity-60">
        <div className="truncate text-sm font-medium">{season.name || `Season ${season.seasonNumber}`}</div>
        <div className="text-muted-foreground truncate text-xs">
          {upcoming || !season.episodeCount
            ? releaseLabel(season.airDate)
            : `${season.episodeCount} episode${season.episodeCount === 1 ? "" : "s"}`}
        </div>
      </div>
    </button>
  );
}

function MissingEpisode({ episode, tmdbId }: { episode: SeerrEpisode; tmdbId?: number }) {
  const { navigate } = useNav();
  const target = requestTarget(tmdbId);
  const still = tmdbImage(episode.stillPath, "w300");
  const upcoming = isUpcoming(episode.airDate);
  return (
    <button
      onClick={() => target && navigate(target)}
      title={target ? "Not on your server. Open it in Requests." : "Not on your server"}
      className="hover:bg-card/60 flex gap-5 rounded-xl p-2 text-left transition-colors"
    >
      <div className="bg-card relative aspect-video w-56 shrink-0 overflow-hidden rounded-lg border border-dashed">
        {still && <img src={still} alt="" loading="lazy" className="size-full object-cover opacity-35 grayscale" />}
        <span className="absolute top-2 left-2 rounded-md bg-black/75 px-1.5 py-0.5 text-xs font-medium text-white/80">
          {upcoming ? "Upcoming" : "Not on server"}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-1 py-1 opacity-60">
        <div className="font-medium">
          <span className="text-muted-foreground mr-2">{episode.episodeNumber}</span>
          {episode.name || `Episode ${episode.episodeNumber}`}
        </div>
        <div className={cn("text-xs", upcoming ? "text-primary" : "text-muted-foreground")}>
          {releaseLabel(episode.airDate)}
        </div>
        {episode.overview && <p className="text-muted-foreground line-clamp-2 text-sm">{episode.overview}</p>}
      </div>
    </button>
  );
}

function Episodes({
  episodes,
  title = "Episodes",
  missing = [],
  tmdbId,
}: {
  episodes: Metadata[] | null;
  title?: string;
  /** Episodes the server doesn't have, shown greyed out in order among the others. */
  missing?: SeerrEpisode[];
  tmdbId?: number;
}) {
  const { server, navigate } = useNav();
  const rows =
    episodes === null
      ? []
      : [
          ...episodes.map((e) => ({ index: e.index ?? Infinity, e, m: null })),
          ...missing.map((m) => ({ index: m.episodeNumber, e: null, m })),
        ].sort((a, b) => a.index - b.index);
  return (
    <section className="flex flex-col gap-2">
      <h2 className="mb-1 text-lg font-semibold">{title}</h2>
      {episodes === null && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      {rows.map(({ e, m }) =>
        m ? (
          <MissingEpisode key={`missing-${m.episodeNumber}`} episode={m} tmdbId={tmdbId} />
        ) : (
          <EpisodeRow key={e!.ratingKey} e={e!} server={server} navigate={navigate} />
        ),
      )}
    </section>
  );
}

function EpisodeRow({
  e,
  server,
  navigate,
}: {
  e: Metadata;
  server: ReturnType<typeof useNav>["server"];
  navigate: ReturnType<typeof useNav>["navigate"];
}) {
  return (
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
  );
}

/** Your own 1-5 star rating, saved to Plex (which counts two points a star). */
function StarRating({ item }: { item: Metadata }) {
  const [rating, setRating] = useState(item.userRating ?? null);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => setRating(item.userRating ?? null), [item.ratingKey, item.userRating]);
  const stars = hover ?? (rating != null ? rating / 2 : 0);

  const rate = (n: number) => {
    // Clicking the current rating clears it.
    const next = rating === n * 2 ? null : n * 2;
    const before = rating;
    setRating(next);
    library.rate(item.ratingKey, next).catch(() => setRating(before));
  };

  return (
    <span
      className="flex items-center"
      title={rating != null ? `Your rating: ${rating / 2} of 5. Click it again to clear.` : "Rate it"}
      onMouseLeave={() => setHover(null)}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          onMouseEnter={() => setHover(n)}
          onClick={() => rate(n)}
          className="p-0.5"
        >
          <Star
            className={cn(
              "size-4 transition-colors",
              n <= stars ? "fill-amber-400 text-amber-400" : "text-muted-foreground/60",
              // Ratings from other apps can land on half stars.
              n - 0.5 === stars && "fill-amber-400/50 text-amber-400",
            )}
          />
        </button>
      ))}
    </span>
  );
}

/** Directors or writers, each opening their page when Plex has an id for them. */
function People({ tags, role }: { tags: Tag[]; role: "director" | "writer" }) {
  const { navigate } = useNav();
  return (
    <>
      {tags.slice(0, 4).map((t, i) => (
        <span key={`${t.tag}-${i}`}>
          {i > 0 && ", "}
          {t.id != null ? (
            <button
              className="text-foreground/90 hover:text-primary hover:underline"
              onClick={() => navigate({ name: "person", role, id: t.id!, title: t.tag, thumb: t.thumb })}
            >
              {t.tag}
            </button>
          ) : (
            t.tag
          )}
        </span>
      ))}
    </>
  );
}

/** Plex's extra types, by `extraType`. */
const EXTRA_LABELS: Record<number, string> = {
  1: "Trailer",
  2: "Deleted scene",
  3: "Interview",
  4: "Music video",
  5: "Behind the scenes",
  6: "Scene",
  7: "Live music video",
  8: "Lyric music video",
  9: "Concert",
  10: "Featurette",
  11: "Short",
  12: "Other",
};

function Extras({ extras }: { extras: Metadata[] }) {
  const { server, navigate } = useNav();
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Extras</h2>
      <div className="-mx-2 flex gap-4 overflow-x-auto px-2 pb-2 [scrollbar-width:none]">
        {extras.map((x) => (
          <button
            key={x.ratingKey}
            onClick={() => navigate({ name: "player", ratingKey: x.ratingKey, resume: false })}
            className="group flex w-64 shrink-0 flex-col gap-2 text-left"
          >
            <div className="bg-card relative aspect-video overflow-hidden rounded-lg border">
              {x.thumb && (
                <img
                  src={imageUrl(server, x.thumb, 256, 144)}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover transition-transform group-hover:scale-105"
                />
              )}
              <span className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                <Play className="size-8 fill-white text-white" />
              </span>
              {x.duration ? (
                <span className="absolute right-2 bottom-2 rounded bg-black/75 px-1.5 py-0.5 text-xs text-white tabular-nums">
                  {formatTime(x.duration / 1000)}
                </span>
              ) : null}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{x.title}</div>
              <div className="text-muted-foreground text-xs">{EXTRA_LABELS[x.extraType ?? 12] ?? "Extra"}</div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function Cast({ item }: { item: Metadata }) {
  const { server, navigate } = useNav();
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Cast</h2>
      <div className="-mx-2 flex gap-5 overflow-x-auto px-2 pb-2 [scrollbar-width:none]">
        {item.Role.slice(0, 20).map((r) => (
          <button
            key={`${r.tag}-${r.role}`}
            disabled={r.id == null}
            onClick={() => r.id != null && navigate({ name: "person", role: "actor", id: r.id, title: r.tag, thumb: r.thumb })}
            className="group flex w-24 shrink-0 flex-col items-center gap-2 text-center enabled:cursor-pointer"
          >
            <Avatar className="size-20 transition-transform group-enabled:group-hover:scale-105">
              {r.thumb && <AvatarImage src={imageUrl(server, r.thumb, 80, 80)} alt={r.tag} className="object-cover" />}
              <AvatarFallback>{r.tag.slice(0, 1)}</AvatarFallback>
            </Avatar>
            <div className="w-full">
              <div className="truncate text-xs font-medium group-enabled:group-hover:underline">{r.tag}</div>
              {r.role && <div className="text-muted-foreground truncate text-xs">{r.role}</div>}
            </div>
          </button>
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
