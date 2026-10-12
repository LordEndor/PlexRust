import { useEffect, useState } from "react";
import { Info, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { imageUrl, library, type Hub, type Metadata } from "@/lib/api";
import { progress, subtitle } from "@/lib/format";
import { useNav } from "@/lib/nav";
import { cn } from "@/lib/utils";

const ROTATE_MS = 9000;
const MAX = 6;

/** Home's Recently Added rows: `home.movies.recent`, `home.television.recent`, or a library's `movie.recentlyadded`. */
function isRecentlyAdded(hub: Hub) {
  return /(\.recent|recentlyadded)$/i.test(hub.hubIdentifier);
}

/** The show an episode or season belongs to. */
function showKey(m: Metadata) {
  if (m.type === "episode") return m.grandparentRatingKey;
  if (m.type === "season") return m.parentRatingKey;
  return m.type === "show" ? m.ratingKey : null;
}

/**
 * Recently added movies and shows with artwork, for the banner. Home's TV row
 * lists new episodes or seasons, so those are swapped for their show.
 */
export async function featuredItems(hubs: Hub[]): Promise<Metadata[]> {
  const recent = hubs
    .filter(isRecentlyAdded)
    .flatMap((h) => h.Metadata)
    .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
  const seen = new Set<string>();
  const picks: (Metadata | string)[] = [];
  for (const m of recent) {
    const key = m.type === "movie" ? m.ratingKey : showKey(m);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    picks.push(m.type === "movie" || m.type === "show" ? m : key);
    if (picks.length === MAX * 2) break;
  }
  const items = await Promise.all(
    picks.map((p) => (typeof p === "string" ? library.metadata(p).catch(() => null) : p)),
  );
  return items.filter((m): m is Metadata => !!m?.art).slice(0, MAX);
}

/** Big artwork at the top of Home, cycling through a few recent additions. */
export function FeaturedBanner({ items }: { items: Metadata[] }) {
  const { server, navigate } = useNav();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || items.length < 2) return;
    const t = window.setTimeout(() => setIndex((i) => (i + 1) % items.length), ROTATE_MS);
    return () => window.clearTimeout(t);
  }, [index, paused, items.length]);

  const item = items[index] ?? items[0];
  if (!item) return null;
  const resumable = progress(item) > 0;

  return (
    <section
      className="relative -mx-8 -mt-8 h-[440px] shrink-0 overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {items.map((m, i) => (
        <img
          key={m.ratingKey}
          src={imageUrl(server, m.art, 1600, 900)}
          alt=""
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-1000",
            i === index ? "opacity-100" : "opacity-0",
          )}
        />
      ))}
      <div className="from-background via-background/60 absolute inset-0 bg-gradient-to-t to-transparent" />
      <div className="from-background/90 absolute inset-0 bg-gradient-to-r via-transparent to-transparent" />

      <div key={item.ratingKey} className="animate-in fade-in absolute inset-x-8 bottom-10 flex max-w-2xl flex-col gap-3 duration-700">
        <div className="text-primary text-xs font-semibold tracking-wider uppercase">Recently added</div>
        <h2 className="text-4xl font-bold tracking-tight drop-shadow">{item.title}</h2>
        <div className="text-muted-foreground text-sm">
          {[subtitle(item), item.contentRating].filter(Boolean).join(" · ")}
        </div>
        {item.summary && <p className="text-foreground/80 line-clamp-3 text-sm leading-relaxed">{item.summary}</p>}
        <div className="mt-1 flex gap-3">
          {item.type === "movie" && (
            <Button size="lg" onClick={() => navigate({ name: "player", ratingKey: item.ratingKey, resume: resumable })}>
              <Play className="fill-current" /> {resumable ? "Resume" : "Play"}
            </Button>
          )}
          <Button size="lg" variant="secondary" onClick={() => navigate({ name: "item", ratingKey: item.ratingKey })}>
            <Info /> More info
          </Button>
        </div>
      </div>

      {items.length > 1 && (
        <div className="absolute right-8 bottom-10 flex gap-2">
          {items.map((m, i) => (
            <button
              key={m.ratingKey}
              aria-label={m.title}
              onClick={() => setIndex(i)}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === index ? "bg-primary w-6" : "w-1.5 bg-white/40 hover:bg-white/70",
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}
