import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Loader2, X } from "lucide-react";

import { SeerrPoster } from "@/components/SeerrPoster";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { posterSize, usePrefs } from "@/lib/prefs";
import {
  DISCOVER_ROWS,
  seerr,
  type Browse,
  type DiscoverRowKey,
  type Genre,
  type MediaType,
  type SeerrPage,
  type SeerrResult,
} from "@/lib/seerr";
import { cn } from "@/lib/utils";

interface Category {
  /** Null for trending, which mixes both and can't be sorted or filtered. */
  mediaType: MediaType | null;
  /** Only titles that aren't out yet, so no year or rating filters. */
  upcoming?: boolean;
}

const CATEGORIES: Record<DiscoverRowKey, Category> = {
  trending: { mediaType: null },
  movies: { mediaType: "movie" },
  tv: { mediaType: "tv" },
  upcomingMovies: { mediaType: "movie", upcoming: true },
  upcomingTv: { mediaType: "tv", upcoming: true },
};

interface SortOption {
  key: "popularity" | "date" | "rating" | "title";
  label: string;
  /** The direction a first pick sorts in. */
  desc: boolean;
}

/** The same choices as Seerr's own Sort menu on its Movies and Series pages. */
const SORTS: SortOption[] = [
  { key: "popularity", label: "Popularity", desc: true },
  { key: "date", label: "Release Date", desc: true },
  { key: "rating", label: "TMDB Rating", desc: true },
  { key: "title", label: "Title", desc: false },
];

/** TMDB's names for each sort field. */
const SORT_FIELD: Record<MediaType, Record<SortOption["key"], string>> = {
  movie: { popularity: "popularity", date: "primary_release_date", rating: "vote_average", title: "original_title" },
  tv: { popularity: "popularity", date: "first_air_date", rating: "vote_average", title: "original_name" },
};

interface Sort {
  key: SortOption["key"];
  desc: boolean;
}

const DEFAULT_SORT: Sort = { key: "popularity", desc: true };

interface Option {
  key: string;
  title: string;
}

const RATINGS: Option[] = [6, 7, 8].map((n) => ({ key: String(n), title: `${n}+ rating` }));

/** This year, last year, then decades back to the 1950s. */
function yearOptions(): Option[] {
  const now = new Date().getFullYear();
  const decades: Option[] = [];
  for (let d = Math.floor(now / 10) * 10; d >= 1950; d -= 10) decades.push({ key: `d${d}`, title: `${d}s` });
  return [{ key: `y${now}`, title: String(now) }, { key: `y${now - 1}`, title: String(now - 1) }, ...decades, { key: "older", title: "Before 1950" }];
}

function yearRange(key: string | null): { dateFrom?: string; dateTo?: string } {
  if (!key) return {};
  if (key === "older") return { dateTo: "1949-12-31" };
  const n = Number(key.slice(1));
  const last = key.startsWith("d") ? n + 9 : n;
  return { dateFrom: `${n}-01-01`, dateTo: `${last}-12-31` };
}

/** Today in the viewer's time zone, `YYYY-MM-DD`. */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Picks {
  sort: Sort;
  genre: string | null;
  year: string | null;
  rating: string | null;
}

const NO_PICKS: Picks = { sort: DEFAULT_SORT, genre: null, year: null, rating: null };

function toBrowse(mediaType: MediaType, category: Category, p: Picks): Browse {
  const b: Browse = {
    sortBy: `${SORT_FIELD[mediaType][p.sort.key]}.${p.sort.desc ? "desc" : "asc"}`,
    genre: p.genre ? Number(p.genre) : undefined,
  };
  if (category.upcoming) {
    b.dateFrom = today();
  } else {
    Object.assign(b, yearRange(p.year));
    // Newest first would otherwise open on announced titles years away.
    if (p.sort.key === "date" && p.sort.desc && !b.dateTo) b.dateTo = today();
    if (p.rating) b.minRating = Number(p.rating);
  }
  // Without a vote floor, a sort by score is topped by titles a handful of people rated.
  if (p.sort.key === "rating") b.minVotes = mediaType === "movie" ? 200 : 100;
  return b;
}

/** A Discover row's Show all page: every title in that category, sortable and filterable like Seerr's own pages. */
export function DiscoverAllView({ row }: { row: DiscoverRowKey }) {
  const category = CATEGORIES[row];
  const title = DISCOVER_ROWS.find((r) => r.key === row)?.title ?? "Discover";
  const { mediaType } = category;
  const [picks, setPicks] = useState<Picks>(NO_PICKS);
  const [genres, setGenres] = useState<Genre[]>([]);
  const years = useMemo(yearOptions, []);
  const filtered = picks.genre !== null || picks.year !== null || picks.rating !== null;

  useEffect(() => {
    if (!mediaType) return;
    let live = true;
    seerr
      .genres(mediaType)
      .then((g) => live && setGenres(g))
      .catch(() => live && setGenres([]));
    return () => {
      live = false;
    };
  }, [mediaType]);

  const browse = mediaType ? toBrowse(mediaType, category, picks) : null;
  const browseKey = JSON.stringify(browse);
  const scroller = useRef<HTMLDivElement>(null);

  return (
    <div ref={scroller} className="h-full overflow-y-auto">
      <div className="flex flex-col gap-6 p-8">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {mediaType && (
          <div className="flex flex-wrap items-center gap-2">
            <FilterMenu
              label="Genre"
              values={genres.map((g) => ({ key: String(g.id), title: g.name }))}
              value={picks.genre}
              onChange={(genre) => setPicks((p) => ({ ...p, genre }))}
            />
            {!category.upcoming && (
              <>
                <FilterMenu label="Year" values={years} value={picks.year} onChange={(year) => setPicks((p) => ({ ...p, year }))} />
                <FilterMenu
                  label="Rating"
                  values={RATINGS}
                  value={picks.rating}
                  onChange={(rating) => setPicks((p) => ({ ...p, rating }))}
                />
              </>
            )}
            {filtered && (
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground h-8"
                onClick={() => setPicks((p) => ({ ...NO_PICKS, sort: p.sort }))}
              >
                <X /> Clear
              </Button>
            )}
            <div className="ml-auto">
              <SortMenu sort={picks.sort} onChange={(sort) => setPicks((p) => ({ ...p, sort }))} />
            </div>
          </div>
        )}
        <Results
          key={browseKey}
          scroller={scroller}
          load={(page) => (mediaType && browse ? seerr.browse(mediaType, page, browse) : seerr.discover(row, page))}
          filtered={filtered}
        />
      </div>
    </div>
  );
}

/** A grid that loads the next page as its end scrolls into view. */
function Results({
  load,
  scroller,
  filtered,
}: {
  load: (page: number) => Promise<SeerrPage>;
  scroller: React.RefObject<HTMLDivElement | null>;
  filtered: boolean;
}) {
  const [items, setItems] = useState<SeerrResult[] | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const sentinel = useRef<HTMLDivElement>(null);
  const size = posterSize(usePrefs());
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    loadRef
      .current(page)
      .then((p) => {
        if (!live) return;
        const found = p.results.filter((r) => r.mediaType !== "person");
        // TMDB's pages shift as popularity changes, so a title can turn up twice.
        setItems((cur) => {
          const seen = new Set((page === 1 ? [] : (cur ?? [])).map(resultKey));
          return [...(page === 1 ? [] : (cur ?? [])), ...found.filter((r) => !seen.has(resultKey(r)) && seen.add(resultKey(r)))];
        });
        setPages(p.totalPages);
      })
      .catch((e) => live && setError(errorMessage(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [page, attempt]);

  const more = !loading && !error && page < pages;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && setPage((p) => p + 1), {
      root: scroller.current,
      rootMargin: "0px 0px 800px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [more, scroller]);

  if (error && !items?.length) return <p className="text-destructive text-sm">{error}</p>;
  if (items?.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">{filtered ? "Nothing matches these filters." : "Nothing here right now."}</p>
    );
  }

  const grid = { gridTemplateColumns: `repeat(auto-fill, minmax(${size.poster}px, 1fr))` };
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-x-4 gap-y-6" style={grid}>
        {items === null
          ? Array.from({ length: 18 }, (_, i) => <Skeleton key={i} className="aspect-[2/3] rounded-xl" />)
          : items.map((r) => <SeerrPoster key={resultKey(r)} item={r} />)}
      </div>
      <div ref={sentinel} />
      {items !== null && loading && <Loader2 className="text-muted-foreground size-5 animate-spin self-center" />}
      {error && items?.length ? (
        <div className="flex items-center justify-center gap-3 text-sm">
          <span className="text-destructive">{error}</span>
          <Button size="sm" variant="outline" onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function resultKey(r: SeerrResult) {
  return `${r.mediaType}:${r.id}`;
}

function SortMenu({ sort, onChange }: { sort: Sort; onChange: (sort: Sort) => void }) {
  const option = SORTS.find((s) => s.key === sort.key) ?? SORTS[0];
  const Arrow = sort.desc ? ArrowDown : ArrowUp;
  // Picking the current sort again flips its direction.
  const pick = (s: SortOption) => onChange({ key: s.key, desc: s === option ? !sort.desc : s.desc });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="h-8">
          By {option.label}
          <Arrow className="opacity-70" />
          <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {SORTS.map((s) => {
          const active = s === option;
          return (
            <DropdownMenuItem
              key={s.key}
              onSelect={() => pick(s)}
              className={cn("justify-between", active && "text-primary focus:text-primary")}
            >
              {s.label}
              {active && <Arrow className="text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FilterMenu({
  label,
  values,
  value,
  onChange,
}: {
  label: string;
  values: Option[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const picked = values.find((v) => v.key === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant={picked ? "secondary" : "outline"}
          disabled={values.length === 0}
          className={cn("h-8", picked && "border-primary/60 border")}
        >
          {picked ? picked.title : label} <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        <DropdownMenuCheckItem checked={!picked} onSelect={() => onChange(null)}>
          Any {label.toLowerCase()}
        </DropdownMenuCheckItem>
        {values.map((v) => (
          <DropdownMenuCheckItem key={v.key} checked={v.key === value} onSelect={() => onChange(v.key)}>
            {v.title}
          </DropdownMenuCheckItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
