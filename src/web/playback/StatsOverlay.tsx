// WP4 owns this file.
import type { PlaybackPlan, SourceMedia } from "./types";

export interface StatsOverlayProps {
  plan: PlaybackPlan;
  source: SourceMedia;
  /** Plex transcode session id; null in direct play. */
  session: string | null;
  video: HTMLVideoElement | null;
  onClose: () => void;
}

/** "Stats for nerds": how this file is playing and why. */
export function StatsOverlay(_props: StatsOverlayProps) {
  return null;
}
