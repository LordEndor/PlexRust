import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Library, Loader2, Send, Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { useNav } from "@/lib/nav";
import {
  availability,
  MediaStatus,
  notifyRequestsChanged,
  RequestStatus,
  resultTitle,
  resultYear,
  seerr,
  TONE_CLASS,
  tmdbImage,
  useRequestsChanged,
  type MediaInfo,
  type MediaType,
  type Quota,
  type SeerrDetails,
  type SeerrInfo,
} from "@/lib/seerr";
import { cn } from "@/lib/utils";

/** A title from Seerr: what it is, whether it's on the server, and a button to request it. */
export function RequestView({ mediaType, tmdbId }: { mediaType: MediaType; tmdbId: number }) {
  const [details, setDetails] = useState<SeerrDetails | null>(null);
  const [info, setInfo] = useState<SeerrInfo | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useRequestsChanged(useCallback(() => setVersion((v) => v + 1), []));

  useEffect(() => {
    let live = true;
    seerr
      .details(mediaType, tmdbId)
      .then((d) => live && setDetails(d))
      .catch((e) => live && setError(errorMessage(e)));
    seerr
      .info()
      .then((i) => live && setInfo(i))
      .catch(() => {});
    seerr
      .quota()
      .then((q) => live && setQuota(q))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [mediaType, tmdbId, version]);

  if (error) return <p className="text-destructive p-8 text-sm">{error}</p>;
  if (!details) {
    return (
      <div className="flex gap-8 p-8 pt-16">
        <Skeleton className="aspect-[2/3] w-56 rounded-2xl" />
        <div className="flex flex-1 flex-col justify-end gap-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
    );
  }

  const status = availability(details.mediaInfo);
  const rating = details.voteAverage;
  const runtime = details.runtime || details.episodeRunTime?.[0];
  const meta = [
    mediaType === "tv" ? "Show" : "Movie",
    resultYear(details),
    runtime ? `${runtime} min` : null,
    mediaType === "tv" && details.numberOfSeasons ? `${details.numberOfSeasons} seasons` : null,
  ].filter(Boolean);
  const backdrop = tmdbImage(details.backdropPath, "w1280");

  return (
    <div className="h-full overflow-y-auto">
      <div className="relative">
        {backdrop && (
          <div className="absolute inset-0 h-[520px] overflow-hidden">
            <img src={backdrop} alt="" className="size-full object-cover opacity-40" />
            <div className="from-background via-background/70 absolute inset-0 bg-gradient-to-t to-transparent" />
            <div className="from-background absolute inset-0 bg-gradient-to-r via-transparent to-transparent" />
          </div>
        )}
        <div className="relative flex gap-8 px-8 pt-16 pb-10">
          <div className="w-56 shrink-0">
            <div className="bg-card aspect-[2/3] overflow-hidden rounded-2xl border shadow-2xl">
              {details.posterPath && (
                <img src={tmdbImage(details.posterPath, "w500")} alt="" className="size-full object-cover" />
              )}
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-end gap-4">
            <h1 className="text-4xl font-bold tracking-tight">{resultTitle(details)}</h1>
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {meta.map((m, i) => (
                <span key={i}>{m}</span>
              ))}
              {rating ? (
                <span className="flex items-center gap-1">
                  <Star className="fill-primary text-primary size-3.5" /> {rating.toFixed(1)}
                </span>
              ) : null}
              {status && (
                <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-semibold", TONE_CLASS[status.tone])}>
                  {status.label}
                </span>
              )}
            </div>
            {details.genres && details.genres.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {details.genres.map((g) => (
                  <Badge key={g.id} variant="secondary">
                    {g.name}
                  </Badge>
                ))}
              </div>
            )}
            {details.tagline && <p className="text-lg italic">{details.tagline}</p>}
            {details.overview && (
              <p className="text-muted-foreground line-clamp-5 max-w-3xl text-sm leading-relaxed">{details.overview}</p>
            )}
            {mediaType === "movie" ? (
              <MovieActions details={details} info={info} />
            ) : (
              <div className="flex gap-3 empty:hidden">
                <LibraryButton media={details.mediaInfo} />
              </div>
            )}
            <QuotaLine quota={quota} mediaType={mediaType} />
          </div>
        </div>
      </div>
      {mediaType === "tv" && <SeasonPicker details={details} info={info} />}
    </div>
  );
}

/** Opens the title in the library once Plex has it. */
function LibraryButton({ media }: { media: MediaInfo | null | undefined }) {
  const { navigate } = useNav();
  const onServer = media?.status === MediaStatus.Available || media?.status === MediaStatus.PartiallyAvailable;
  if (!media?.ratingKey || !onServer) return null;
  const ratingKey = media.ratingKey;
  return (
    <Button size="lg" onClick={() => navigate({ name: "item", ratingKey })}>
      <Library /> Open in library
    </Button>
  );
}

/** Missing, deleted from the server, or never seen: all can be requested. */
function requestable(status: number | undefined) {
  return !status || status === MediaStatus.Unknown || status === MediaStatus.Deleted;
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  async function submit(run: () => ReturnType<typeof seerr.request>) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await run();
      setMessage({
        text:
          r.status === RequestStatus.Approved
            ? "Requested and approved. It shows up in your library once it has downloaded."
            : "Requested. It's waiting for approval in Seerr.",
      });
      notifyRequestsChanged();
    } catch (e) {
      setMessage({ text: errorMessage(e), error: true });
    } finally {
      setBusy(false);
    }
  }
  return { busy, message, submit };
}

function Message({ message }: { message: { text: string; error?: boolean } | null }) {
  if (!message) return null;
  return <p className={cn("text-sm", message.error ? "text-destructive" : "text-muted-foreground")}>{message.text}</p>;
}

function MovieActions({ details, info }: { details: SeerrDetails; info: SeerrInfo | null }) {
  const { busy, message, submit } = useSubmit();
  const media = details.mediaInfo;
  const can = requestable(media?.status);
  const can4k = !!info?.movie4k && requestable(media?.status4k);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <LibraryButton media={media} />
        {can && (
          <Button size="lg" disabled={busy} onClick={() => submit(() => seerr.request("movie", details.id))}>
            {busy ? <Loader2 className="animate-spin" /> : <Send />} Request
          </Button>
        )}
        {can4k && (
          <Button
            size="lg"
            variant="secondary"
            disabled={busy}
            onClick={() => submit(() => seerr.request("movie", details.id, [], true))}
          >
            Request in 4K
          </Button>
        )}
      </div>
      <Message message={message} />
    </div>
  );
}

/** Seasons already on the server or asked for, so they can't be picked again. */
function takenSeasons(media: MediaInfo | null | undefined, fourK: boolean) {
  const taken = new Map<number, string>();
  for (const s of media?.seasons ?? []) {
    const status = fourK ? s.status4k : s.status;
    if (status === MediaStatus.Available) taken.set(s.seasonNumber, "Available");
    else if (status === MediaStatus.PartiallyAvailable) taken.set(s.seasonNumber, "Partly available");
    else if (status === MediaStatus.Processing || status === MediaStatus.Pending) taken.set(s.seasonNumber, "Requested");
  }
  for (const r of media?.requests ?? []) {
    if (r.is4k !== fourK || r.status === RequestStatus.Declined || r.status === RequestStatus.Failed) continue;
    for (const s of r.seasons ?? []) if (!taken.has(s.seasonNumber)) taken.set(s.seasonNumber, "Requested");
  }
  return taken;
}

function SeasonPicker({ details, info }: { details: SeerrDetails; info: SeerrInfo | null }) {
  const [fourK, setFourK] = useState(false);
  const { busy, message, submit } = useSubmit();
  // Specials (season 0) are left out, like in Seerr itself.
  const seasons = useMemo(() => (details.seasons ?? []).filter((s) => s.seasonNumber > 0), [details.seasons]);
  const taken = useMemo(() => takenSeasons(details.mediaInfo, fourK), [details.mediaInfo, fourK]);
  const open = seasons.filter((s) => !taken.has(s.seasonNumber)).map((s) => s.seasonNumber);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  // Start with every missing season ticked.
  const openKey = open.join(",");
  useEffect(() => {
    setPicked(new Set(openKey ? openKey.split(",").map(Number) : []));
  }, [openKey]);

  function toggle(n: number) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }

  const chosen = [...picked].sort((a, b) => a - b);

  return (
    <div className="relative flex flex-col gap-4 px-8 pb-12">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-lg font-semibold">Seasons</h2>
        {info?.tv4k && (
          <Button variant={fourK ? "default" : "outline"} onClick={() => setFourK((v) => !v)}>
            {fourK && <Check />} 4K
          </Button>
        )}
        {open.length > 0 && (
          <Button
            disabled={busy || chosen.length === 0}
            onClick={() => submit(() => seerr.request("tv", details.id, chosen, fourK))}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Send />}
            {chosen.length === open.length && taken.size === 0
              ? "Request all seasons"
              : `Request ${chosen.length} season${chosen.length === 1 ? "" : "s"}`}
          </Button>
        )}
      </div>
      <Message message={message} />
      <div className="bg-card divide-y rounded-xl border">
        {seasons.map((s) => {
          const state = taken.get(s.seasonNumber);
          return (
            <label
              key={s.seasonNumber}
              className={cn("flex items-center gap-4 px-5 py-3", state ? "opacity-70" : "hover:bg-accent/40 cursor-pointer")}
            >
              <input
                type="checkbox"
                className="accent-primary size-4"
                disabled={!!state}
                checked={state ? true : picked.has(s.seasonNumber)}
                onChange={() => toggle(s.seasonNumber)}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{s.name || `Season ${s.seasonNumber}`}</div>
                <div className="text-muted-foreground text-xs">
                  {s.episodeCount} episodes{s.airDate ? ` · ${s.airDate.slice(0, 4)}` : ""}
                </div>
              </div>
              {state && <Badge variant="secondary">{state}</Badge>}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function QuotaLine({ quota, mediaType }: { quota: Quota | null; mediaType: MediaType }) {
  const part = quota?.[mediaType];
  if (!part?.limit) return null;
  const unit = mediaType === "movie" ? "movie" : "season";
  return (
    <p className="text-muted-foreground text-xs">
      {part.remaining ?? 0} of {part.limit} {unit} requests left
      {part.days ? ` (limit per ${part.days} days)` : ""}.
    </p>
  );
}
