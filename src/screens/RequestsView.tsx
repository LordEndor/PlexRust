import { useCallback, useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";

import { DownloadChip } from "@/components/DownloadChip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { useNav } from "@/lib/nav";
import {
  notifyRequestsChanged,
  RequestStatus,
  requestStatus,
  seerr,
  TONE_CLASS,
  tmdbImage,
  useRequestsChanged,
  type SeerrRequest,
} from "@/lib/seerr";
import { cn } from "@/lib/utils";

/** Your requests in Seerr, newest first. */
export function RequestsView() {
  const [requests, setRequests] = useState<SeerrRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useRequestsChanged(useCallback(() => setVersion((v) => v + 1), []));

  useEffect(() => {
    let live = true;
    seerr
      .requests()
      .then((r) => live && setRequests(r))
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [version]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
        <h1 className="text-2xl font-semibold">My requests</h1>
        {error && <p className="text-destructive text-sm">{error}</p>}
        {requests === null && !error && <Skeleton className="h-64 rounded-xl" />}
        {requests?.length === 0 && (
          <p className="text-muted-foreground text-sm">You haven't requested anything yet. Find something in Discover.</p>
        )}
        {requests && requests.length > 0 && (
          <div className="bg-card divide-y rounded-xl border">
            {requests.map((r) => (
              <RequestRow key={r.id} request={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RequestRow({ request: r }: { request: SeerrRequest }) {
  const { navigate } = useNav();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = requestStatus(r);
  const seasons = r.seasons?.map((s) => s.seasonNumber).sort((a, b) => a - b) ?? [];
  const what = [
    r.media.mediaType === "tv" ? "Show" : "Movie",
    r.year,
    seasons.length > 0 ? `Season${seasons.length === 1 ? "" : "s"} ${seasons.join(", ")}` : null,
    r.is4k ? "4K" : null,
    `Requested ${new Date(r.createdAt).toLocaleDateString()}`,
  ].filter(Boolean);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await seerr.cancel(r.id);
      notifyRequestsChanged();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <button
        className="flex min-w-0 flex-1 items-center gap-4 text-left"
        onClick={() => navigate({ name: "request", mediaType: r.media.mediaType, tmdbId: r.media.tmdbId })}
      >
        <div className="bg-muted aspect-[2/3] w-12 shrink-0 overflow-hidden rounded-md border">
          {r.posterPath && <img src={tmdbImage(r.posterPath, "w185")} alt="" className="size-full object-cover" />}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{r.title ?? `TMDB ${r.media.tmdbId}`}</div>
          <div className="text-muted-foreground truncate text-xs">{what.join(" · ")}</div>
          {error && <div className="text-destructive text-xs">{error}</div>}
        </div>
      </button>
      <DownloadChip
        match={
          r.media.mediaType === "movie"
            ? { kind: "movie", tmdbId: r.media.tmdbId }
            : { kind: "show", tmdbId: r.media.tmdbId }
        }
      />
      <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold", TONE_CLASS[status.tone])}>
        {status.label}
      </span>
      {r.status === RequestStatus.Pending && (
        <Button variant="ghost" size="icon" title="Cancel request" disabled={busy} onClick={cancel}>
          {busy ? <Loader2 className="animate-spin" /> : <X />}
        </Button>
      )}
    </div>
  );
}
