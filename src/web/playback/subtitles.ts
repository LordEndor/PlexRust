// WP3 owns this file.
import type { SubtitleDelivery } from "./types";

/**
 * Shows a sidecar subtitle on `video`: WebVTT through a <track>, ASS/SSA through
 * JASSUB. Does nothing for `none` and `burn` (Plex draws those). Resolves to a
 * cleanup function. Rejects when the subtitle can't be fetched or parsed, so the
 * player can fall back to burning it in.
 */
export async function attachSubtitles(_video: HTMLVideoElement, _delivery: SubtitleDelivery): Promise<() => void> {
  throw new Error("WP3: not implemented");
}
