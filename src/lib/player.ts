import { invoke } from "@tauri-apps/api/core";

export interface Marker {
  type: "intro" | "credits" | string;
  startTimeOffset: number;
  endTimeOffset: number;
  final?: boolean | null;
}

export interface PlaybackInfo {
  ratingKey: string;
  title: string;
  subtitle?: string | null;
  durationMs: number;
  viewOffsetMs: number;
  url: string;
  externalSubtitles: { url: string; title: string; language?: string | null }[];
  markers: Marker[];
  mpvPath: string;
}

export type PlaybackState = "playing" | "paused" | "stopped";

export const playback = {
  info: (ratingKey: string) => invoke<PlaybackInfo>("playback_info", { ratingKey }),
  transcodeUrl: (ratingKey: string, maxBitrateKbps: number, resolution: string, session: string) =>
    invoke<string>("transcode_url", { ratingKey, maxBitrateKbps, resolution, offsetSecs: 0, session }),
  stopTranscode: (session: string) => invoke<void>("stop_transcode", { session }),
  report: (ratingKey: string, playbackState: PlaybackState, timeMs: number, durationMs: number) =>
    invoke<void>("report_progress", {
      ratingKey,
      playbackState,
      timeMs: Math.round(timeMs),
      durationMs: Math.round(durationMs),
    }),
};

export interface Quality {
  label: string;
  /** Undefined means play the original file. */
  kbps?: number;
  resolution?: string;
}

export const QUALITIES: Quality[] = [
  { label: "Original" },
  { label: "20 Mbps · 1080p", kbps: 20000, resolution: "1920x1080" },
  { label: "8 Mbps · 1080p", kbps: 8000, resolution: "1920x1080" },
  { label: "4 Mbps · 720p", kbps: 4000, resolution: "1280x720" },
  { label: "2 Mbps · 720p", kbps: 2000, resolution: "1280x720" },
];

export function formatTime(secs: number) {
  if (!Number.isFinite(secs) || secs < 0) secs = 0;
  const s = Math.floor(secs % 60);
  const m = Math.floor((secs / 60) % 60);
  const h = Math.floor(secs / 3600);
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}
