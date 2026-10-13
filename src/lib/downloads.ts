import { createContext, useContext, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface QbitConfig {
  url: string;
  username: string;
  hasPassword: boolean;
}

export interface QbitVersion {
  /** Such as `v5.0.2`. */
  app: string;
  api: string;
}

export type TorrentState =
  | "downloading"
  | "stalled"
  | "queued"
  | "checking"
  | "seeding"
  | "completed"
  | "paused"
  | "error";

/** One torrent; see `crates/qbit`. */
export interface Torrent {
  hash: string;
  name: string;
  state: TorrentState;
  rawState: string;
  /** 0 to 1. */
  progress: number;
  size: number;
  downloaded: number;
  /** Bytes per second. */
  dlSpeed: number;
  upSpeed: number;
  /** Seconds left. */
  eta: number | null;
  seeds: number;
  peers: number;
  category: string;
  ratio: number;
  /** Unix seconds. */
  addedOn: number;
  completedOn: number | null;
  forceStart: boolean;
  savePath: string;
}

/** The movie or episodes Radarr or Sonarr is fetching with a torrent. */
export interface DownloadMedia {
  kind: "movie" | "episode";
  title: string;
  year?: number | null;
  poster?: string | null;
  tmdbId?: number | null;
  tvdbId?: number | null;
  seasonNumber?: number | null;
  /** Several for a season pack. */
  episodes: number[];
  episodeTitle?: string | null;
  /** Such as `downloading`, `importPending` or `imported`. */
  state?: string | null;
}

export interface Snapshot {
  torrents: Torrent[];
  transfer: { dlSpeed: number; upSpeed: number; freeSpace: number | null; altSpeed: boolean };
  categories: string[];
  /** By torrent hash, for the torrents Radarr or Sonarr know. */
  media: Record<string, DownloadMedia>;
}

export type DownloadAction = "pause" | "resume" | "forceStart" | "recheck" | "delete" | "deleteWithFiles";

/** Typed wrappers around `src-tauri/src/downloads.rs`. */
export const qbit = {
  config: () => invoke<QbitConfig>("qbit_config"),
  connect: (url: string, username: string, password: string | null) =>
    invoke<QbitVersion>("qbit_connect", { url, username, password }),
  disconnect: () => invoke<void>("qbit_disconnect"),
  list: () => invoke<Snapshot>("downloads_list"),
  act: (action: DownloadAction, hashes: string[]) => invoke<void>("downloads_action", { action, hashes }),
  toggleAltSpeed: () => invoke<void>("downloads_toggle_alt_speed"),
};

const CONFIG_EVENT = "plexrust:qbit-config";

/** Tells the sidebar that qBittorrent was set up or removed. */
export function notifyQbitConfigChanged() {
  window.dispatchEvent(new Event(CONFIG_EVENT));
}

/** Whether qBittorrent is set up; null while loading. Always false in the browser version for now. */
export function useDownloadsEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    const load = () =>
      qbit
        .config()
        .then((c) => setEnabled(c.url !== ""))
        .catch(() => setEnabled(false));
    load();
    window.addEventListener(CONFIG_EVENT, load);
    return () => window.removeEventListener(CONFIG_EVENT, load);
  }, []);
  return enabled;
}

/**
 * The torrent list, refreshed every `everyMs` while the window is visible.
 * `refresh` asks again right away, such as after pausing something.
 */
export function useDownloads(enabled: boolean, everyMs: number) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setSnapshot(null);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (document.visibilityState === "visible") {
        try {
          const s = await qbit.list();
          if (stopped) return;
          setSnapshot(s);
          setError(null);
        } catch (e) {
          if (stopped) return;
          setError(e instanceof Error ? e.message : String(e));
        }
      }
      if (!stopped) timer = setTimeout(load, everyMs);
    };
    load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled, everyMs, tick]);
  return { snapshot, error, refresh: () => setTick((t) => t + 1) };
}

/** The list the sidebar keeps, shared with screens that show download progress. */
export const DownloadsContext = createContext<Snapshot | null>(null);

export function useDownloadsSnapshot() {
  return useContext(DownloadsContext);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "S02E05 · Trojan's Horse", "Season 2 · 8 episodes" or the year. */
export function mediaSubtitle(m: DownloadMedia) {
  if (m.kind === "movie") return m.year ? String(m.year) : "Movie";
  if (m.episodes.length === 1 && m.seasonNumber != null) {
    return [`S${pad(m.seasonNumber)}E${pad(m.episodes[0])}`, m.episodeTitle].filter(Boolean).join(" · ");
  }
  const season = m.seasonNumber != null ? `Season ${m.seasonNumber}` : "Several seasons";
  return m.episodes.length > 1 ? `${season} · ${m.episodes.length} episodes` : season;
}

/** "Severance S02E05" for a toast. */
export function mediaName(m: DownloadMedia) {
  if (m.kind === "movie") return m.title;
  if (m.episodes.length === 1 && m.seasonNumber != null) return `${m.title} S${pad(m.seasonNumber)}E${pad(m.episodes[0])}`;
  return m.seasonNumber != null ? `${m.title} season ${m.seasonNumber}` : m.title;
}

/** What to look for: a movie, a whole show, or one episode of it. */
export type DownloadMatch =
  | { kind: "movie"; tmdbId?: number | null }
  | { kind: "show"; tmdbId?: number | null; tvdbId?: number | null; season?: number | null; episode?: number | null };

function matches(m: DownloadMedia, want: DownloadMatch) {
  if (want.kind === "movie") return m.kind === "movie" && want.tmdbId != null && m.tmdbId === want.tmdbId;
  if (m.kind !== "episode") return false;
  const sameShow =
    (want.tvdbId != null && m.tvdbId === want.tvdbId) || (want.tmdbId != null && m.tmdbId === want.tmdbId);
  if (!sameShow) return false;
  if (want.season != null && m.seasonNumber != null && m.seasonNumber !== want.season) return false;
  if (want.episode != null && m.episodes.length > 0 && !m.episodes.includes(want.episode)) return false;
  return true;
}

export interface DownloadProgress {
  /** 0 to 1, over every matching torrent. */
  progress: number;
  /** Seconds until the slowest one is done, when known. */
  eta: number | null;
  stalled: boolean;
}

/** Progress of unfinished downloads of a title, or null when nothing is downloading it. */
export function downloadProgress(snapshot: Snapshot | null, want: DownloadMatch): DownloadProgress | null {
  if (!snapshot) return null;
  const hits = snapshot.torrents.filter((t) => t.progress < 1 && snapshot.media[t.hash] && matches(snapshot.media[t.hash], want));
  if (hits.length === 0) return null;
  const size = hits.reduce((n, t) => n + t.size, 0);
  const done = hits.reduce((n, t) => n + t.downloaded, 0);
  const etas = hits.map((t) => t.eta);
  return {
    progress: size > 0 ? done / size : hits[0].progress,
    eta: etas.every((e) => e != null) ? Math.max(...(etas as number[])) : null,
    stalled: hits.every((t) => t.dlSpeed === 0),
  };
}

/** Downloading in any way: the count on the sidebar. */
export function isActive(t: Torrent) {
  return t.progress < 1 && (t.state === "downloading" || t.state === "stalled" || t.state === "queued" || t.state === "checking");
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function formatSpeed(n: number) {
  return `${formatBytes(n)}/s`;
}

/** "14 min", "2 h 5 min", "3 days". */
export function formatEta(seconds: number) {
  if (seconds < 60) return "under a minute";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `${h} h ${mins % 60} min`;
  return `${Math.round(h / 24)} days`;
}

export const STATE_LABELS: Record<TorrentState, string> = {
  downloading: "Downloading",
  stalled: "Stalled",
  queued: "Queued",
  checking: "Checking",
  seeding: "Seeding",
  completed: "Completed",
  paused: "Paused",
  error: "Error",
};

export const STATE_CLASS: Record<TorrentState, string> = {
  downloading: "border-sky-500/40 bg-sky-500/15 text-sky-300",
  stalled: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  queued: "border-white/15 bg-white/5 text-muted-foreground",
  checking: "border-white/15 bg-white/5 text-muted-foreground",
  seeding: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  completed: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  paused: "border-white/15 bg-white/5 text-muted-foreground",
  error: "border-red-500/40 bg-red-500/15 text-red-300",
};
