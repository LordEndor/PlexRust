/**
 * Remembers, for this browser tab, which lighter plan a kind of file needed
 * after Plex's transcoder couldn't keep up, so the next episode starts there
 * instead of stalling again first. Forgotten after a few hours, or when the
 * viewer picks a quality themselves.
 */
import type { LighterStep, SourceMedia } from "./types";

const KEY = "plexrust.lighterSteps";
const KEEP_MS = 6 * 60 * 60 * 1000;

type Saved = Record<string, { step: LighterStep; at: number }>;

/** Files that cost Plex the same to transcode share a kind. */
export function sourceKind(source: SourceMedia): string {
  const subs = source.subtitle ? "subs" : "nosubs";
  return [source.videoCodec, source.height, source.bitDepth ?? 8, source.hdr ? "hdr" : "sdr", subs].join("/");
}

function read(): Saved {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Saved;
  } catch {
    return {};
  }
}

function write(saved: Saved) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Private mode or blocked storage: the player just steps down again next time.
  }
}

export function rememberedStep(source: SourceMedia, now = Date.now()): LighterStep | null {
  const hit = read()[sourceKind(source)];
  return hit && now - hit.at < KEEP_MS ? hit.step : null;
}

export function rememberStep(source: SourceMedia, step: LighterStep, now = Date.now()) {
  write({ ...read(), [sourceKind(source)]: { step, at: now } });
}

export function forgetStep(source: SourceMedia) {
  const saved = read();
  delete saved[sourceKind(source)];
  write(saved);
}

/** Seconds of starved playback before the player steps down. */
export const STALL_SECS = 15;
/** Past this, it steps down even when Plex claims to be keeping up. */
export const STALL_SECS_HARD = 40;

/**
 * One second of watchdog bookkeeping: starved seconds add up, and playing
 * wins them back at half speed, so a transcode running at half real time
 * still trips it eventually.
 */
export function tickStarved(starved: number, waiting: boolean): number {
  return waiting ? starved + 1 : Math.max(0, starved - 0.5);
}
