import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { Poster } from "@/components/Poster";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, library, type LibrarySection, type Metadata } from "@/lib/api";

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

/**
 * Poster grid for a whole library. Only the rows on screen are rendered and
 * items are fetched a page at a time as you scroll, so a 10,000 title library
 * scrolls as smoothly as a 10 title one.
 */
export function LibraryView({ section }: { section: LibrarySection }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [sort, setSort] = useState(SORTS[0].key);
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
      try {
        const res = await library.sectionItems(section.key, page * PAGE, PAGE, sort);
        setTotal(res.total);
        setItems((prev) => {
          const next = prev.length >= res.total ? prev.slice() : Object.assign(new Array(res.total), prev);
          res.items.forEach((m, i) => (next[page * PAGE + i] = m));
          return next;
        });
      } catch (e) {
        requested.current.delete(page);
        setError(errorMessage(e));
      }
    },
    [section.key, sort],
  );

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
