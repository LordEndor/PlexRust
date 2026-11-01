import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, imageUrl, library, type Metadata } from "@/lib/api";
import { useLibraryChanged } from "@/lib/changes";
import { useNav } from "@/lib/nav";

const PAGE = 100;

function dayLabel(secs: number) {
  const d = new Date(secs * 1000);
  const today = new Date();
  const days = Math.round(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86_400_000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: days < 7 ? "long" : undefined,
    day: "numeric",
    month: "long",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

/** What was watched on this server, most recent first, by day. */
export function HistoryView() {
  const [items, setItems] = useState<Metadata[] | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (start: number) => {
    setLoading(true);
    try {
      const page = await library.history(start, PAGE);
      setItems((prev) => (start === 0 ? page : [...(prev ?? []), ...page]));
      setMore(page.length === PAGE);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
      setItems((prev) => prev ?? []);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load(0);
  }, [load]);
  useLibraryChanged(() => load(0));

  const days: [string, Metadata[]][] = [];
  for (const m of items ?? []) {
    const label = m.viewedAt ? dayLabel(m.viewedAt) : "Earlier";
    const last = days[days.length - 1];
    if (last?.[0] === label) last[1].push(m);
    else days.push([label, [m]]);
  }

  return (
    <div className="flex h-full flex-col gap-8 overflow-y-auto p-8">
      <h1 className="text-2xl font-semibold">History</h1>
      {error && <p className="text-destructive text-sm">{error}</p>}
      {items === null && <Skeleton className="h-64 rounded-xl" />}
      {items?.length === 0 && !error && <p className="text-muted-foreground text-sm">Nothing watched yet.</p>}
      {days.map(([label, list]) => (
        <section key={label} className="flex flex-col gap-1">
          <h2 className="text-muted-foreground mb-1 text-sm font-semibold tracking-wide uppercase">{label}</h2>
          {list.map((m, i) => (
            <Entry key={`${m.ratingKey}-${m.viewedAt}-${i}`} item={m} />
          ))}
        </section>
      ))}
      {more && (
        <Button variant="outline" className="self-center" disabled={loading} onClick={() => load(items?.length ?? 0)}>
          {loading ? "Loading…" : "Show more"}
        </Button>
      )}
    </div>
  );
}

function Entry({ item }: { item: Metadata }) {
  const { server, navigate } = useNav();
  const episode = item.type === "episode";
  const thumb = episode ? (item.thumb ?? item.grandparentThumb) : (item.art ?? item.thumb);
  const time = item.viewedAt
    ? new Date(item.viewedAt * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : "";
  return (
    <button
      onClick={() => item.ratingKey && navigate({ name: "item", ratingKey: item.ratingKey })}
      className="hover:bg-card flex items-center gap-4 rounded-xl p-2 text-left transition-colors"
    >
      <div className="bg-card aspect-video w-36 shrink-0 overflow-hidden rounded-lg border">
        {thumb && <img src={imageUrl(server, thumb, 144, 81)} alt="" loading="lazy" className="size-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{episode ? item.grandparentTitle : item.title}</div>
        <div className="text-muted-foreground truncate text-sm">
          {episode ? `S${item.parentIndex} · E${item.index} · ${item.title}` : item.year}
        </div>
      </div>
      <div className="text-muted-foreground shrink-0 text-sm tabular-nums">{time}</div>
    </button>
  );
}
