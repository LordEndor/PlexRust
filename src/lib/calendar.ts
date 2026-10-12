import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type ArrKind = "radarr" | "sonarr";

export const ARR_NAMES: Record<ArrKind, string> = { radarr: "Radarr", sonarr: "Sonarr" };

export interface ArrServerConfig {
  url: string;
  hasApiKey: boolean;
}

export type ArrConfig = Record<ArrKind, ArrServerConfig>;

export interface ArrStatus {
  appName: string;
  version: string;
}

export type MovieRelease = "cinema" | "digital" | "physical";

/** One movie release date or one episode airing; see `crates/arr`. */
export interface Release {
  id: string;
  kind: "movie" | "episode";
  title: string;
  year?: number | null;
  /** `YYYY-MM-DD`. */
  date: string;
  /** Exact air time of an episode. */
  airDateUtc?: string | null;
  movieRelease?: MovieRelease | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  episodeTitle?: string | null;
  hasFile: boolean;
  monitored: boolean;
  overview?: string | null;
  runtime?: number | null;
  network?: string | null;
  poster?: string | null;
  fanart?: string | null;
  tmdbId?: number | null;
  tvdbId?: number | null;
}

export interface Calendar {
  releases: Release[];
  errors: { source: ArrKind; message: string }[];
}

/** Typed wrappers around `src-tauri/src/calendar.rs` (`src/web/services.ts` in the browser). */
export const arr = {
  config: () => invoke<ArrConfig>("arr_config"),
  connect: (kind: ArrKind, url: string, apiKey: string | null) => invoke<ArrStatus>("arr_connect", { kind, url, apiKey }),
  disconnect: (kind: ArrKind) => invoke<void>("arr_disconnect", { kind }),
  calendar: (start: string, end: string) => invoke<Calendar>("arr_calendar", { start, end }),
};

const CONFIG_EVENT = "plexrust:arr-config";

/** Tells the sidebar that Radarr or Sonarr was set up or removed. */
export function notifyArrConfigChanged() {
  window.dispatchEvent(new Event(CONFIG_EVENT));
}

/** Whether Radarr or Sonarr is set up; null while loading. */
export function useCalendarEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    const load = () =>
      arr
        .config()
        .then((c) => setEnabled(c.radarr.url !== "" || c.sonarr.url !== ""))
        .catch(() => setEnabled(false));
    load();
    window.addEventListener(CONFIG_EVENT, load);
    return () => window.removeEventListener(CONFIG_EVENT, load);
  }, []);
  return enabled;
}

/** `YYYY-MM-DD` of a date in local time. */
export function dayKey(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDay(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** The local day a release lands on: episodes by their exact air time. */
export function releaseDay(r: Release) {
  return r.airDateUtc ? dayKey(new Date(r.airDateUtc)) : r.date;
}

export function releaseTime(r: Release) {
  return r.airDateUtc ? new Date(r.airDateUtc).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : null;
}

export function episodeCode(r: Release) {
  if (r.seasonNumber == null || r.episodeNumber == null) return null;
  return `S${String(r.seasonNumber).padStart(2, "0")}E${String(r.episodeNumber).padStart(2, "0")}`;
}

export const MOVIE_RELEASE_LABELS: Record<MovieRelease, string> = {
  cinema: "In cinemas",
  digital: "Digital release",
  physical: "Blu-ray / DVD",
};

/** The second line under a title: episode code and name, or which release it is. */
export function releaseSubtitle(r: Release) {
  if (r.kind === "movie") return r.movieRelease ? MOVIE_RELEASE_LABELS[r.movieRelease] : "Movie";
  const code = episodeCode(r);
  const premiere = r.episodeNumber === 1 ? (r.seasonNumber === 1 ? "Series premiere" : "Season premiere") : null;
  return [code, r.episodeTitle ?? premiere].filter(Boolean).join(" · ");
}

/** Colors that tell movies and episodes apart everywhere in the calendar. */
export const KIND_CLASS = {
  movie: { dot: "bg-violet-500", chip: "border-violet-500/40 bg-violet-500/15 hover:bg-violet-500/25" },
  episode: { dot: "bg-sky-500", chip: "border-sky-500/40 bg-sky-500/15 hover:bg-sky-500/25" },
} as const;
