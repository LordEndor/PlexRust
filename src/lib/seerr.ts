import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/** Requests go through the Rust side, so the browser version has none (Seerr blocks cross-site calls). */
export const SEERR_SUPPORTED = import.meta.env.MODE !== "web";

export type MediaType = "movie" | "tv";

export interface SeerrConfig {
  url: string;
  hasApiKey: boolean;
}

export interface SeerrInfo {
  version: string;
  userName: string;
  user: { id: number; permissions: number };
  movie4k: boolean;
  tv4k: boolean;
}

/** Availability on the Plex server, as Seerr tracks it. */
export const MediaStatus = {
  Unknown: 1,
  Pending: 2,
  Processing: 3,
  PartiallyAvailable: 4,
  Available: 5,
  Blocklisted: 6,
  Deleted: 7,
} as const;

/** Where a request is in Seerr's approval flow. */
export const RequestStatus = { Pending: 1, Approved: 2, Declined: 3, Failed: 4, Completed: 5 } as const;

export interface SeasonInfo {
  seasonNumber: number;
  status: number;
  status4k?: number;
}

export interface MediaInfo {
  id: number;
  tmdbId: number;
  status: number;
  status4k?: number;
  /** The Plex item, once it's in the library. */
  ratingKey?: string | null;
  seasons?: SeasonInfo[];
  requests?: SeerrRequest[];
}

/** A movie, show or person from search and discover lists. */
export interface SeerrResult {
  id: number;
  mediaType: MediaType | "person";
  title?: string;
  name?: string;
  posterPath?: string | null;
  backdropPath?: string | null;
  releaseDate?: string;
  firstAirDate?: string;
  overview?: string;
  voteAverage?: number;
  mediaInfo?: MediaInfo | null;
}

export interface SeerrPage {
  page: number;
  totalPages: number;
  totalResults: number;
  results: SeerrResult[];
}

export interface SeerrSeason {
  seasonNumber: number;
  name: string;
  episodeCount: number;
  airDate?: string | null;
}

export interface SeerrDetails extends SeerrResult {
  tagline?: string;
  runtime?: number;
  episodeRunTime?: number[];
  genres?: { id: number; name: string }[];
  seasons?: SeerrSeason[];
  numberOfSeasons?: number;
  status?: string;
}

export interface SeerrRequest {
  id: number;
  status: number;
  is4k: boolean;
  createdAt: string;
  media: MediaInfo & { mediaType: MediaType };
  seasons?: { seasonNumber: number; status: number }[];
  /** Added by the app from the title's details. */
  title?: string | null;
  year?: string | null;
  posterPath?: string | null;
}

export interface QuotaPart {
  limit?: number | null;
  days?: number | null;
  used?: number;
  remaining?: number | null;
  restricted?: boolean;
}

export interface Quota {
  movie?: QuotaPart;
  tv?: QuotaPart;
}

export const DISCOVER_ROWS = [
  { key: "trending", title: "Trending" },
  { key: "movies", title: "Popular movies" },
  { key: "tv", title: "Popular shows" },
  { key: "upcomingMovies", title: "Upcoming movies" },
  { key: "upcomingTv", title: "Upcoming shows" },
] as const;

/** Typed wrappers around `src-tauri/src/requests.rs`. */
export const seerr = {
  config: () => invoke<SeerrConfig>("seerr_config"),
  connect: (url: string, apiKey: string | null, clearApiKey = false) =>
    invoke<SeerrInfo>("seerr_connect", { url, apiKey, clearApiKey }),
  disconnect: () => invoke<void>("seerr_disconnect"),
  info: () => invoke<SeerrInfo>("seerr_info"),
  search: (query: string, page = 1) => invoke<SeerrPage>("seerr_search", { query, page }),
  discover: (row: string, page = 1) => invoke<SeerrPage>("seerr_discover", { row, page }),
  details: (mediaType: MediaType, tmdbId: number) => invoke<SeerrDetails>("seerr_details", { mediaType, tmdbId }),
  quota: () => invoke<Quota>("seerr_quota"),
  request: (mediaType: MediaType, tmdbId: number, seasons: number[] = [], is4k = false) =>
    invoke<SeerrRequest>("seerr_request", { request: { mediaType, tmdbId, seasons, is4k } }),
  requests: () => invoke<SeerrRequest[]>("seerr_requests"),
  cancel: (requestId: number) => invoke<void>("seerr_cancel", { requestId }),
};

const CONFIG_EVENT = "plexrust:seerr-config";

/** Tells the sidebar that requests were set up or turned off. */
export function notifySeerrConfigChanged() {
  window.dispatchEvent(new Event(CONFIG_EVENT));
}

/** Whether a Seerr server is set up; null while loading. */
export function useSeerrEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(SEERR_SUPPORTED ? null : false);
  useEffect(() => {
    if (!SEERR_SUPPORTED) return;
    const load = () =>
      seerr
        .config()
        .then((c) => setEnabled(c.url !== ""))
        .catch(() => setEnabled(false));
    load();
    window.addEventListener(CONFIG_EVENT, load);
    return () => window.removeEventListener(CONFIG_EVENT, load);
  }, []);
  return enabled;
}

const CHANGED_EVENT = "plexrust:seerr-requests";

/** Tells open screens that a request was made or cancelled. */
export function notifyRequestsChanged() {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function useRequestsChanged(onChange: () => void) {
  useEffect(() => {
    window.addEventListener(CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CHANGED_EVENT, onChange);
  }, [onChange]);
}

/** TMDB artwork. Widths TMDB serves: posters w92–w780, backdrops w300–w1280. */
export function tmdbImage(path: string | null | undefined, width: "w185" | "w342" | "w500" | "w780" | "w1280") {
  return path ? `https://image.tmdb.org/t/p/${width}${path}` : undefined;
}

export function resultTitle(r: { title?: string | null; name?: string | null }) {
  return r.title || r.name || "Untitled";
}

export function resultYear(r: { releaseDate?: string; firstAirDate?: string }) {
  return (r.releaseDate || r.firstAirDate || "").slice(0, 4);
}

export interface StatusLabel {
  label: string;
  tone: "available" | "partial" | "requested" | "declined";
}

/** The badge for a title, or null when it can still be requested. */
export function availability(info: MediaInfo | null | undefined): StatusLabel | null {
  switch (info?.status) {
    case MediaStatus.Available:
      return { label: "Available", tone: "available" };
    case MediaStatus.PartiallyAvailable:
      return { label: "Partly available", tone: "partial" };
    case MediaStatus.Processing:
      return { label: "Requested", tone: "requested" };
    case MediaStatus.Pending:
      return { label: "Pending approval", tone: "requested" };
    default:
      return null;
  }
}

export function requestStatus(r: SeerrRequest): StatusLabel {
  if (r.status === RequestStatus.Declined) return { label: "Declined", tone: "declined" };
  if (r.status === RequestStatus.Failed) return { label: "Failed", tone: "declined" };
  if (r.status === RequestStatus.Pending) return { label: "Pending approval", tone: "requested" };
  const media = r.is4k ? r.media.status4k : r.media.status;
  if (media === MediaStatus.Available) return { label: "Available", tone: "available" };
  if (media === MediaStatus.PartiallyAvailable) return { label: "Partly available", tone: "partial" };
  return { label: "Approved, downloading", tone: "requested" };
}

export const TONE_CLASS: Record<StatusLabel["tone"], string> = {
  available: "bg-emerald-500/90 text-white",
  partial: "bg-sky-500/90 text-white",
  requested: "bg-amber-500/90 text-black",
  declined: "bg-red-500/90 text-white",
};
