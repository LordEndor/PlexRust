import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, Clapperboard, ChevronLeft, ChevronRight, Film, Search, Tv } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import {
  addDays,
  arr,
  dayKey,
  KIND_CLASS,
  parseDay,
  releaseDay,
  releaseSubtitle,
  releaseTime,
  type Calendar,
  type Release,
} from "@/lib/calendar";
import { errorMessage } from "@/lib/api";
import { useNav } from "@/lib/nav";
import { cn } from "@/lib/utils";

type Mode = "month" | "upcoming";
type Filter = "all" | "movie" | "episode";

const UPCOMING_DAYS = 60;
const MAX_CHIPS = 3;
const MODE_KEY = "plexrust.calendarMode";
const CINEMA_KEY = "plexrust.calendarCinema";

function readCinema() {
  try {
    return localStorage.getItem(CINEMA_KEY) === "1";
  } catch {
    return false;
  }
}

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "upcoming" ? "upcoming" : "month";
  } catch {
    return "month";
  }
}

/** The six Monday-first weeks shown for the month holding `month`. */
function monthGrid(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** Loads releases for a range of local days. Sonarr matches on UTC air time, so a day either side is asked for too. */
function useReleases(start: Date, end: Date) {
  const [data, setData] = useState<Calendar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const from = dayKey(start);
  const to = dayKey(end);
  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    arr
      .calendar(dayKey(addDays(start, -1)), dayKey(addDays(end, 1)))
      .then((c) => live && setData(c))
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [from, to]);
  return { data, error };
}

function groupByDay(releases: Release[], filter: Filter, cinema: boolean, from: string, to: string) {
  const days = new Map<string, Release[]>();
  for (const r of releases) {
    if (filter !== "all" && r.kind !== filter) continue;
    if (!cinema && r.movieRelease === "cinema") continue;
    const day = releaseDay(r);
    if (day < from || day > to) continue;
    days.set(day, [...(days.get(day) ?? []), r]);
  }
  return days;
}

/** Upcoming movies from Radarr and episodes from Sonarr, as a month or a list. */
export function CalendarView() {
  const [mode, setModeState] = useState<Mode>(readMode);
  const [filter, setFilter] = useState<Filter>("all");
  const [cinema, setCinemaState] = useState(readCinema);

  function toggleCinema() {
    setCinemaState((c) => {
      try {
        localStorage.setItem(CINEMA_KEY, c ? "0" : "1");
      } catch {
        // Not remembered.
      }
      return !c;
    });
  }
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [open, setOpen] = useState<Release | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);

  function setMode(m: Mode) {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // Not remembered.
    }
  }

  const today = new Date();
  const grid = useMemo(() => monthGrid(month), [month]);
  const [start, end] = mode === "month" ? [grid[0], grid[41]] : [today, addDays(today, UPCOMING_DAYS)];
  const { data, error } = useReleases(start, end);
  const [from, to] = [dayKey(start), dayKey(end)];
  const days = useMemo(() => groupByDay(data?.releases ?? [], filter, cinema, from, to), [data, filter, cinema, from, to]);

  const monthTitle = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const shiftMonth = (by: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + by, 1));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 p-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-2xl font-semibold">Calendar</h1>
          <Button
            variant={cinema ? "secondary" : "outline"}
            size="sm"
            aria-pressed={cinema}
            disabled={filter === "episode"}
            onClick={toggleCinema}
            title={cinema ? "Hide cinema release dates" : "Show cinema release dates too"}
          >
            <Clapperboard /> In cinemas{cinema ? <Check /> : null}
          </Button>
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "movie", label: "Movies" },
              { value: "episode", label: "Episodes" },
            ]}
          />
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "month", label: "Month" },
              { value: "upcoming", label: "Upcoming" },
            ]}
          />
        </div>

        {mode === "month" && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => shiftMonth(-1)} title="Previous month">
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="icon" onClick={() => shiftMonth(1)} title="Next month">
              <ChevronRight />
            </Button>
            <h2 className="ml-2 text-lg font-semibold capitalize">{monthTitle}</h2>
            <div className="flex-1" />
            <Legend />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}
            >
              Today
            </Button>
          </div>
        )}

        {error && <p className="text-destructive text-sm">{error}</p>}
        {data?.errors.map((e) => (
          <p key={e.source} className="text-destructive text-sm">
            {e.message.charAt(0).toUpperCase() + e.message.slice(1)}
          </p>
        ))}

        {mode === "month" ? (
          <MonthGrid
            grid={grid}
            month={month}
            days={days}
            loading={!data && !error}
            onOpen={setOpen}
            onOpenDay={setOpenDay}
          />
        ) : !data && !error ? (
          <Skeleton className="h-96 rounded-xl" />
        ) : (
          <Upcoming days={days} onOpen={setOpen} />
        )}
      </div>

      <DayDialog
        day={openDay}
        releases={openDay ? (days.get(openDay) ?? []) : []}
        onClose={() => setOpenDay(null)}
        onOpen={(r) => {
          setOpenDay(null);
          setOpen(r);
        }}
      />
      <ReleaseDialog release={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function Legend() {
  return (
    <div className="text-muted-foreground mr-2 flex items-center gap-4 text-xs">
      <span className="flex items-center gap-1.5">
        <span className={cn("size-2 rounded-full", KIND_CLASS.movie.dot)} /> Movies
      </span>
      <span className="flex items-center gap-1.5">
        <span className={cn("size-2 rounded-full", KIND_CLASS.episode.dot)} /> Episodes
      </span>
      <span className="flex items-center gap-1.5">
        <Check className="size-3 text-emerald-500" /> Downloaded
      </span>
    </div>
  );
}

function MonthGrid({
  grid,
  month,
  days,
  loading,
  onOpen,
  onOpenDay,
}: {
  grid: Date[];
  month: Date;
  days: Map<string, Release[]>;
  loading: boolean;
  onOpen: (r: Release) => void;
  onOpenDay: (day: string) => void;
}) {
  const today = dayKey(new Date());
  const weekdays = grid.slice(0, 7).map((d) => d.toLocaleDateString(undefined, { weekday: "short" }));
  return (
    <div className="bg-card overflow-hidden rounded-xl border">
      <div className="text-muted-foreground grid grid-cols-7 border-b text-xs font-medium">
        {weekdays.map((w) => (
          <div key={w} className="px-2 py-2 capitalize">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {grid.map((d, i) => {
          const key = dayKey(d);
          const items = days.get(key) ?? [];
          const outside = d.getMonth() !== month.getMonth();
          return (
            <div
              key={key}
              className={cn(
                "flex min-h-28 min-w-0 flex-col gap-1 p-1.5",
                i % 7 !== 6 && "border-r",
                i < 35 && "border-b",
                outside && "bg-muted/30",
              )}
            >
              <div
                className={cn(
                  "flex size-6 items-center justify-center self-end rounded-full text-xs tabular-nums",
                  outside && "text-muted-foreground",
                  key === today && "bg-primary text-primary-foreground font-semibold",
                )}
              >
                {d.getDate()}
              </div>
              {loading ? (
                i % 5 === 2 && <Skeleton className="h-5" />
              ) : (
                <>
                  {items.slice(0, MAX_CHIPS).map((r) => (
                    <Chip key={r.id} release={r} onClick={() => onOpen(r)} />
                  ))}
                  {items.length > MAX_CHIPS && (
                    <button
                      className="text-muted-foreground hover:text-foreground px-1 text-left text-xs"
                      onClick={() => onOpenDay(key)}
                    >
                      +{items.length - MAX_CHIPS} more
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Chip({ release: r, onClick }: { release: Release; onClick: () => void }) {
  const detail = r.kind === "episode" ? releaseSubtitle(r).split(" · ")[0] : releaseSubtitle(r);
  return (
    <button
      onClick={onClick}
      title={`${r.title} · ${releaseSubtitle(r)}`}
      className={cn(
        "flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-left text-xs transition-colors",
        KIND_CLASS[r.kind].chip,
      )}
    >
      {r.kind === "movie" ? <Film className="size-3 shrink-0" /> : <Tv className="size-3 shrink-0" />}
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{r.title}</span>
        {detail && <span className="text-muted-foreground"> {detail}</span>}
      </span>
      {r.hasFile && <Check className="size-3 shrink-0 text-emerald-500" />}
    </button>
  );
}

function dayHeading(key: string) {
  const today = new Date();
  if (key === dayKey(today)) return "Today";
  if (key === dayKey(addDays(today, 1))) return "Tomorrow";
  return parseDay(key).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

function Upcoming({ days, onOpen }: { days: Map<string, Release[]>; onOpen: (r: Release) => void }) {
  const keys = [...days.keys()].sort();
  if (keys.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 py-16 text-sm">
        <CalendarDays className="size-8" />
        Nothing coming up in the next {UPCOMING_DAYS} days.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {keys.map((key) => (
        <section key={key} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold capitalize">{dayHeading(key)}</h2>
          <div className="bg-card divide-y rounded-xl border">
            {days.get(key)!.map((r) => (
              <ReleaseRow key={r.id} release={r} onClick={() => onOpen(r)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function KindBadge({ release: r }: { release: Release }) {
  return (
    <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
      <span className={cn("size-2 rounded-full", KIND_CLASS[r.kind].dot)} />
      {r.kind === "movie" ? "Movie" : "Episode"}
    </span>
  );
}

function ReleaseRow({ release: r, onClick }: { release: Release; onClick: () => void }) {
  const time = releaseTime(r);
  return (
    <button onClick={onClick} className="hover:bg-accent/40 flex w-full items-center gap-4 px-4 py-3 text-left">
      <Poster release={r} className="w-12" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{r.title}</div>
        <div className="text-muted-foreground truncate text-xs">{releaseSubtitle(r)}</div>
        {r.overview && <div className="text-muted-foreground mt-1 line-clamp-1 text-xs">{r.overview}</div>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <KindBadge release={r} />
        <span className="text-muted-foreground text-xs tabular-nums">
          {[time, r.network].filter(Boolean).join(" · ")}
        </span>
        {r.hasFile && (
          <span className="flex items-center gap-1 text-xs text-emerald-500">
            <Check className="size-3" /> Downloaded
          </span>
        )}
      </div>
    </button>
  );
}

function Poster({ release: r, className }: { release: Release; className?: string }) {
  const Icon = r.kind === "movie" ? Film : Tv;
  return (
    <div
      className={cn(
        "bg-muted text-muted-foreground flex aspect-[2/3] shrink-0 items-center justify-center overflow-hidden rounded-md border",
        className,
      )}
    >
      {r.poster ? (
        <img src={r.poster} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <Icon className="size-4" />
      )}
    </div>
  );
}

function DayDialog({
  day,
  releases,
  onClose,
  onOpen,
}: {
  day: string | null;
  releases: Release[];
  onClose: () => void;
  onOpen: (r: Release) => void;
}) {
  return (
    <Dialog open={day !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <div className="px-6 pt-6 pb-2">
          <DialogTitle className="capitalize">{day && dayHeading(day)}</DialogTitle>
          <DialogDescription>
            {releases.length} release{releases.length === 1 ? "" : "s"}
          </DialogDescription>
        </div>
        <div className="divide-y overflow-y-auto pb-2">
          {releases.map((r) => (
            <ReleaseRow key={r.id} release={r} onClick={() => onOpen(r)} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReleaseDialog({ release: r, onClose }: { release: Release | null; onClose: () => void }) {
  const { navigate } = useNav();
  return (
    <Dialog open={r !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="overflow-hidden">
        {r && (
          <>
            {r.fanart && (
              <div className="relative h-40 shrink-0">
                <img src={r.fanart} alt="" className="size-full object-cover" />
                <div className="from-popover absolute inset-0 bg-gradient-to-t to-transparent" />
              </div>
            )}
            <div className="flex gap-5 overflow-y-auto p-6">
              <Poster release={r} className="w-28" />
              <div className="flex min-w-0 flex-col gap-2">
                <DialogTitle>
                  {r.title}
                  {r.year && r.kind === "movie" ? <span className="text-muted-foreground font-normal"> ({r.year})</span> : null}
                </DialogTitle>
                <DialogDescription>{releaseSubtitle(r)}</DialogDescription>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <KindBadge release={r} />
                  <span className="text-muted-foreground text-xs">
                    {[
                      parseDay(releaseDay(r)).toLocaleDateString(undefined, {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      }),
                      releaseTime(r),
                      r.network,
                      r.runtime ? `${r.runtime} min` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {r.hasFile && (
                    <span className="flex items-center gap-1 text-xs text-emerald-500">
                      <Check className="size-3" /> Downloaded
                    </span>
                  )}
                </div>
                {r.overview && <p className="text-sm leading-relaxed">{r.overview}</p>}
                {r.hasFile && (
                  <div className="pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        onClose();
                        navigate({ name: "search", query: r.title });
                      }}
                    >
                      <Search /> Find in library
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
