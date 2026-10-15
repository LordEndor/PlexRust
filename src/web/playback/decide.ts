// WP1 owns this file.
import type { BrowserCaps, DecideOptions, PlaybackPlan, QualityChoice, SourceMedia } from "./types";

/** The best way to play `source` in this browser at this quality. */
export function decide(_source: SourceMedia, _caps: BrowserCaps, _quality: QualityChoice, _opts: DecideOptions = {}): PlaybackPlan {
  throw new Error("WP1: not implemented");
}

/** The next step down after `plan` failed to play, or null when nothing is left. */
export function fallback(_plan: PlaybackPlan, _source: SourceMedia, _caps: BrowserCaps, _quality: QualityChoice): PlaybackPlan | null {
  throw new Error("WP1: not implemented");
}
