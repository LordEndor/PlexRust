import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, X } from "lucide-react";

import { Poster } from "@/components/Poster";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, library, type FilterValue, type Filters, type LibrarySection, type Metadata } from "@/lib/api";
import { cn } from "@/lib/utils";

const PAGE = 120;
const MIN_COL = 160;
const GAP = 20;
const CAPTION = 44;

const SORTS = [
  { key: "titleSort", label: "A–Z" },
  { key: "addedAt:desc", label: "Recently added" },
  { key: "originallyAvailableAt:desc", label: "Newest" },
  { key: "audienceRating:desc", label: "Top rated" },
];

const RESOLUTIONS: FilterValue[] = [
  { key: "4k", title: "4K" },
  { key: "1080", title: "1080p" },
  { key: "720", title: "720p" },
  { key: "480", title: "480p" },
  { key: "sd", title: "SD" },
];

const BITRATES: FilterValue[] = [
  { key: "10000", title: "10 Mbps or more" },
  { key: "20000", title: "20 Mbps or more" },
  { key: "40000", title: "40 Mbps or more" },
  { key: "80000", title: "80 Mbps or more" },
];

/** The library's movies or shows, or its collections. */
export function LibraryView({ section }: { section: LibrarySection }) {
  const [view, setView] = useState<"all" | "collections">("all");
  const [collections, setCollections] = useState<Metadata[] | null>(null);

  useEffect(() => {
    setView("all");
    setCollections(null);
    library
      .collections(section.key)
      .then(setCollections)
      .catch(() => setCollections([]));
  }, [section.key]);

  const toggle =
    collections && collections.length > 0 ? (
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: "all", label: section.type === "show" ? "Shows" : "Movies" },
          { value: "collections", label: "Collections" },
        ]}
      />
    ) : null;

  return view === "collections" && collections ? (
    <CollectionsGrid section={section} collections={collections} toggle={toggle} />
  ) : (
    <ItemsGrid section={section} toggle={toggle} />
  );
}

function CollectionsGrid({
  section,
  collections,
  toggle,
}: {
  section: LibrarySection;
  collections: Metadata[];
  toggle: React.ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto px-8 pb-8">
      <header className="bg-background/95 sticky top-0 z-10 -mx-8 mb-4 flex items-center gap-3 px-8 py-4 backdrop-blur">
        <h1 className="flex-1 text-2xl font-semibold">
          {section.title}
          <span className="text-muted-foreground ml-3 text-sm font-normal">{collections.length} collections</span>
        </h1>
        {toggle}
      </header>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-5">
        {collections.map((c) => (
          <Poster key={c.ratingKey} item={c} />
        ))}
      </div>
    </div>
  );
}

/**
 * Poster grid for a whole library. Only the rows on screen are rendered and
 * items are fetched a page at a time as you scroll, so a 10,000 title library
 * scrolls as smoothly as a 10 title one.
 */
function ItemsGrid({ section, toggle }: { section: LibrarySection; toggle: React.ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [sort, setSort] = useState(SORTS[0].key);
  const [filters, setFilters] = useState<Filters>({});
  const [genres, setGenres] = useState<FilterValue[]>([]);
  const [decades, setDecades] = useState<FilterValue[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [items, setItems] = useState<(Metadata | undefined)[]>([]);
  const [error, setError] = useState<string | null>(null);
  const requested = useRef(new Set<number>());

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - 64));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const loadPage = useCallback(
    async (page: number) => {
      if (requested.current.has(page)) return;
      requested.current.add(page);
      const asked = requested.current;
      try {
        const res = await library.sectionItems(section.key, page * PAGE, PAGE, sort, filters);
        // The sort or filters changed while this page was loading.
        if (asked !== requested.current) return;
        setTotal(res.total);
        setItems((prev) => {
          const next = prev.length >= res.total ? prev.slice() : Object.assign(new Array(res.total), prev);
          res.items.forEach((m, i) => (next[page * PAGE + i] = m));
          return next;
        });
      } catch (e) {
        if (asked !== requested.current) return;
        requested.current.delete(page);
        setError(errorMessage(e));
      }
    },
    [section.key, sort, filters],
  );

  useEffect(() => {
    library.filterValues(section.key, "genre").then(setGenres, () => setGenres([]));
    library.filterValues(section.key, "decade").then(setDecades, () => setDecades([]));
  }, [section.key]);

  const set = (patch: Filters) => setFilters((f) => ({ ...f, ...patch }));
  const filtered = Object.values(filters).some((v) => v != null && v !== false);
  // Resolution and bitrate belong to files, which shows only have per episode.
  const movies = section.type === "movie";

  useEffect(() => {
    requested.current = new Set();
    setItems([]);
    setTotal(null);
    setError(null);
    scrollRef.current?.scrollTo({ top: 0 });
    loadPage(0);
  }, [loadPage]);

  const cols = Math.max(2, Math.floor((width + GAP) / (MIN_COL + GAP)));
  const colWidth = width > 0 ? (width - GAP * (cols - 1)) / cols : MIN_COL;
  const rowHeight = colWidth * 1.5 + CAPTION + GAP;
  const rows = Math.ceil((total ?? 0) / cols);

  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 3,
  });

  useEffect(() => virtualizer.measure(), [rowHeight, virtualizer]);

  const virtualRows = virtualizer.getVirtualItems();
  useEffect(() => {
    if (!virtualRows.length) return;
    const first = virtualRows[0].index * cols;
    const last = (virtualRows[virtualRows.length - 1].index + 1) * cols - 1;
    for (let p = Math.floor(first / PAGE); p <= Math.floor(last / PAGE); p++) loadPage(p);
  }, [virtualRows, cols, loadPage]);

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-8 pb-8">
      <header className="bg-background/95 sticky top-0 z-10 -mx-8 mb-4 flex items-center gap-3 px-8 py-4 backdrop-blur">
        <h1 className="flex-1 text-2xl font-semibold">
          {section.title}
          {total !== null && <span className="text-muted-foreground ml-3 text-sm font-normal">{total} items</span>}
        </h1>
        {toggle}
        <div className="bg-card flex gap-1 rounded-lg border p-1">
          {SORTS.map((s) => (
            <Button
              key={s.key}
              size="sm"
              variant={s.key === sort ? "secondary" : "ghost"}
              className="h-7"
              onClick={() => setSort(s.key)}
            >
              {s.label}
            </Button>
          ))}
        </div>
      </header>

      <div className="-mt-2 mb-5 flex flex-wrap items-center gap-2">
        <FilterMenu label="Genre" values={genres} value={filters.genre} onChange={(genre) => set({ genre })} />
        <FilterMenu label="Decade" values={decades} value={filters.decade} onChange={(decade) => set({ decade })} />
        {movies && (
          <FilterMenu
            label="Resolution"
            values={RESOLUTIONS}
            value={filters.resolution}
            onChange={(resolution) => set({ resolution })}
          />
        )}
        {movies && (
          <FilterMenu
            label="Bitrate"
            values={BITRATES}
            value={filters.minBitrateKbps?.toString()}
            onChange={(b) => set({ minBitrateKbps: b ? Number(b) : null })}
          />
        )}
        <Button
          size="sm"
          variant={filters.unwatched ? "secondary" : "outline"}
          className={cn("h-8", filters.unwatched && "border-primary/60 border")}
          onClick={() => set({ unwatched: !filters.unwatched })}
        >
          Unwatched
        </Button>
        {filtered && (
          <Button size="sm" variant="ghost" className="text-muted-foreground h-8" onClick={() => setFilters({})}>
            <X /> Clear
          </Button>
        )}
      </div>

      {total === 0 && !error && (
        <p className="text-muted-foreground py-16 text-center text-sm">
          {filtered ? "Nothing matches these filters." : "This library is empty."}
        </p>
      )}

      {error && <p className="text-destructive mb-4 text-sm">{error}</p>}

      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualRows.map((row) => (
          <div
            key={row.key}
            className="absolute inset-x-0 grid"
            style={{
              top: row.start,
              height: rowHeight,
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              columnGap: GAP,
            }}
          >
            {Array.from({ length: cols }, (_, c) => {
              const i = row.index * cols + c;
              if (total === null || i >= total) return <div key={c} />;
              const item = items[i];
              return item ? (
                <Poster key={item.ratingKey} item={item} />
              ) : (
                <Skeleton key={c} className="aspect-[2/3] rounded-xl" />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function FilterMenu({
  label,
  values,
  value,
  onChange,
}: {
  label: string;
  values: FilterValue[];
  value?: string | null;
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
