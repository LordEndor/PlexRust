import { useEffect, useState } from "react";

import { library, type Metadata } from "@/lib/api";
import { seerr, type SeerrDetails, type SeerrEpisode, type SeerrSeason } from "@/lib/seerr";

/**
 * Episodes and seasons a show has that the Plex server doesn't, looked up
 * through Seerr (which reads them from TMDB), so they can be listed greyed out.
 */

/** The show's TMDB id from its Plex guids, such as `tmdb://2316`. */
export function tmdbIdFromGuids(m: Pick<Metadata, "Guid">): number | null {
  for (const g of m.Guid ?? []) {
    const id = g.id.match(/^tmdb:\/\/(\d+)$/)?.[1];
    if (id) return Number(id);
  }
  return null;
}

const ids = new Map<string, Promise<number | null>>();
const details = new Map<number, Promise<SeerrDetails>>();

/** The TMDB id of a show, from its guids or else by searching Seerr for its title and year. */
export function showTmdbId(show: Metadata): Promise<number | null> {
  const known = tmdbIdFromGuids(show);
  if (known) return Promise.resolve(known);
  let p = ids.get(show.ratingKey);
  if (!p) {
    p = seerr.search(show.title).then((page) => {
      const shows = page.results.filter((r) => r.mediaType === "tv");
      const year = show.year?.toString();
      const match = shows.find((r) => year && r.firstAirDate?.startsWith(year)) ?? (year ? undefined : shows[0]);
      return match?.id ?? null;
    });
    p.catch(() => ids.delete(show.ratingKey));
    ids.set(show.ratingKey, p);
  }
  return p;
}

function showDetails(tmdbId: number): Promise<SeerrDetails> {
  let p = details.get(tmdbId);
  if (!p) {
    p = seerr.details("tv", tmdbId);
    // Kept for the session, but a failure is tried again next time.
    p.catch(() => details.delete(tmdbId));
    details.set(tmdbId, p);
  }
  return p;
}

/** Seasons TMDB lists that aren't among `have`. Specials are left out, and so are empty seasons with no date. */
export function missingSeasons(have: Metadata[], seasons: SeerrSeason[]): SeerrSeason[] {
  const present = new Set(have.map((s) => s.index));
  return seasons.filter(
    (s) => s.seasonNumber > 0 && !present.has(s.seasonNumber) && (s.episodeCount > 0 || !!s.airDate),
  );
}

/** Episodes TMDB lists for a season that aren't among `have`. */
export function missingEpisodes(have: Metadata[], episodes: SeerrEpisode[]): SeerrEpisode[] {
  const present = new Set(have.map((e) => e.index));
  return episodes.filter((e) => !present.has(e.episodeNumber));
}

/** `YYYY-MM-DD` read as a local date, so it isn't a day off. */
function parseDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** "Airs Dec 3, 2026" for what hasn't aired yet, "Aired Mar 1, 2024" otherwise. */
export function releaseLabel(day: string | null | undefined, today = new Date()): string {
  if (!day) return "Air date not announced";
  const date = parseDay(day);
  const text = date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return date >= midnight ? `Airs ${text}` : `Aired ${text}`;
}

/** Whether `day` is today or later. */
export function isUpcoming(day: string | null | undefined, today = new Date()) {
  if (!day) return true;
  return parseDay(day) >= new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

/** What's missing from a show (its seasons) or a season (its episodes). */
export interface Missing {
  tmdbId: number;
  seasons: SeerrSeason[];
  episodes: SeerrEpisode[];
}

/**
 * Looks up what `item` (a show or season) is missing, given what Plex has
 * (`have`). `season` is set when a single-season show lists that season's
 * episodes on its own page. Nothing is shown when Seerr isn't set up or
 * doesn't know the show.
 */
export function useMissing(
  item: Metadata | null,
  have: Metadata[] | null,
  options: { seasons: boolean; episodes: boolean; season?: { index: number; episodes: Metadata[] | null } | null },
): Missing | null {
  const [missing, setMissing] = useState<Missing | null>(null);
  const seasonIndex = item?.type === "season" ? item.index : options.season?.index;
  const seasonEpisodes = item?.type === "season" ? have : options.season?.episodes;
  const wantSeasons = options.seasons && item?.type === "show" && have !== null;
  const wantEpisodes = options.episodes && seasonIndex != null && seasonEpisodes != null;

  useEffect(() => {
    setMissing(null);
    if (!item || (!wantSeasons && !wantEpisodes)) return;
    let live = true;
    (async () => {
      const show = item.type === "season" && item.parentRatingKey ? await library.metadata(item.parentRatingKey) : item;
      const tmdbId = await showTmdbId(show);
      if (!tmdbId) return;
      const [d, s] = await Promise.all([
        wantSeasons ? showDetails(tmdbId) : null,
        wantEpisodes ? seerr.season(tmdbId, seasonIndex!) : null,
      ]);
      if (!live) return;
      setMissing({
        tmdbId,
        seasons: d ? missingSeasons(have ?? [], d.seasons ?? []) : [],
        episodes: s ? missingEpisodes(seasonEpisodes ?? [], s.episodes ?? []) : [],
      });
    })().catch(() => {});
    return () => {
      live = false;
    };
    // `have` and the season's episodes change identity on every load, which is when to look again.
  }, [item, have, seasonEpisodes, wantSeasons, wantEpisodes, seasonIndex]);

  return missing;
}
