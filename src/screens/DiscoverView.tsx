import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ListChecks, Loader2, Search } from "lucide-react";

import { SeerrPoster } from "@/components/SeerrPoster";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { useNav } from "@/lib/nav";
import { posterSize, usePrefs } from "@/lib/prefs";
import { DISCOVER_ROWS, seerr, type SeerrResult } from "@/lib/seerr";

/** Seerr's catalogue: search anything on TMDB, or browse what's popular, and request what's missing. */
export function DiscoverView({ query: initial }: { query?: string }) {
  const { navigate } = useNav();
  const [query, setQuery] = useState(initial ?? "");
  const [search, setSearch] = useState((initial ?? "").trim());

  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-8 p-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-2xl font-semibold">Discover</h1>
          <div className="relative w-full max-w-sm">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find movies and shows to request"
              className="bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-lg border pr-3 pl-9 text-sm outline-none focus-visible:ring-[3px]"
            />
          </div>
          <Button variant="outline" onClick={() => navigate({ name: "requests" })}>
            <ListChecks /> My requests
          </Button>
        </div>
        {search.length >= 2 ? (
          <SearchResults key={search} query={search} />
        ) : (
          DISCOVER_ROWS.map((row) => <DiscoverRow key={row.key} row={row.key} title={row.title} />)
        )}
      </div>
    </div>
  );
}

function SearchResults({ query }: { query: string }) {
  const [items, setItems] = useState<SeerrResult[] | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const size = posterSize(usePrefs());

  useEffect(() => {
    let live = true;
    setLoading(true);
    seerr
      .search(query, page)
      .then((p) => {
        if (!live) return;
        const found = p.results.filter((r) => r.mediaType !== "person");
        setItems((cur) => (page === 1 ? found : [...(cur ?? []), ...found]));
        setPages(p.totalPages);
      })
      .catch((e) => live && setError(errorMessage(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [query, page]);

  if (error) return <p className="text-destructive text-sm">{error}</p>;
  if (!items) return <Skeleton className="h-72 rounded-xl" />;
  if (items.length === 0) return <p className="text-muted-foreground text-sm">Nothing found for “{query}”.</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-x-4 gap-y-6" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size.poster}px, 1fr))` }}>
        {items.map((r) => (
          <SeerrPoster key={`${r.mediaType}:${r.id}`} item={r} />
        ))}
      </div>
      {page < pages && (
        <Button variant="outline" className="self-center" disabled={loading} onClick={() => setPage((p) => p + 1)}>
          {loading && <Loader2 className="animate-spin" />} Show more
        </Button>
      )}
    </div>
  );
}

function DiscoverRow({ row, title }: { row: string; title: string }) {
  const [items, setItems] = useState<SeerrResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const size = posterSize(usePrefs());

  useEffect(() => {
    let live = true;
    seerr
      .discover(row)
      .then((p) => live && setItems(p.results.filter((r) => r.mediaType !== "person")))
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [row]);

  function scroll(dir: 1 | -1) {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  }

  if (error) {
    return (
      <section>
        <h2 className="mb-2 text-lg font-semibold">{title}</h2>
        <p className="text-destructive text-sm">{error}</p>
      </section>
    );
  }
  if (items?.length === 0) return null;

  return (
    <section className="group/row">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="flex-1 text-lg font-semibold">{title}</h2>
        <div className="flex gap-1 opacity-0 transition-opacity group-hover/row:opacity-100">
          <Button variant="ghost" size="icon" className="size-8" onClick={() => scroll(-1)}>
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={() => scroll(1)}>
            <ChevronRight />
          </Button>
        </div>
      </div>
      <div
        ref={scroller}
        className="-mx-4 -mt-2 flex snap-x scroll-px-4 gap-4 overflow-x-auto px-4 pt-3 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items === null
          ? Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="aspect-[2/3] shrink-0 rounded-xl" style={{ width: size.poster }} />
            ))
          : items.map((r) => (
              <div key={`${r.mediaType}:${r.id}`} className="shrink-0 snap-start" style={{ width: size.poster }}>
                <SeerrPoster item={r} />
              </div>
            ))}
      </div>
    </section>
  );
}
