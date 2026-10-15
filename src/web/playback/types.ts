/**
 * The shared contract for how the browser build picks a way to play a file.
 *
 * The ladder, best first:
 *  - directPlay: the <video> element gets Plex's file URL as is.
 *  - directStream: Plex remuxes the original video into HLS fMP4 segments and
 *    converts only the audio (if needed). The picture is untouched.
 *  - transcode: Plex re-encodes the video. Last resort, or a lower quality picked.
 *
 * Codec and container names are Plex's (lowercase): video h264, hevc, av1,
 * vp9, mpeg2video, vc1; audio aac, mp3, opus, flac, ac3, eac3, dca (DTS),
 * truehd; containers mp4, mov, m4v, webm, mkv, avi, ts.
 */

export type PlaybackMode = "directPlay" | "directStream" | "transcode";

/** What this browser can decode, probed once per page load. */
export interface BrowserCaps {
  /** Video codecs playable through MediaSource in fMP4, by Plex name. */
  videoCodecs: Set<string>;
  /** 10-bit HEVC/AV1 (Main10) decodes. */
  tenBit: boolean;
  /** The display and browser show HDR (PQ/HLG) rather than washing it out. */
  hdr: boolean;
  /** Audio codecs playable in fMP4 or natively, by Plex name. */
  audioCodecs: Set<string>;
  /** Containers a plain <video src> plays natively, by Plex name. */
  containers: Set<string>;
  /** How HLS plays: through hls.js (MediaSource), natively (Safari), or not at all. */
  hls: "mse" | "native" | "none";
}

/** The file being played, reduced to what the decision needs. Built from Plex metadata. */
export interface SourceMedia {
  /** e.g. `/library/parts/123/1700000000/file.mkv` */
  partKey: string;
  partId: number;
  container: string;
  videoCodec: string;
  /** e.g. `main 10`, `high`. */
  videoProfile?: string;
  bitDepth?: number;
  /** HDR10/HLG/Dolby Vision. */
  hdr: boolean;
  dolbyVision: boolean;
  width: number;
  height: number;
  /** Whole-file bitrate. */
  bitrateKbps: number;
  /** The audio stream that will play. */
  audioCodec: string;
  audioChannels: number;
  /** The picked audio is the file's first audio track. A <video src> can only play that one. */
  audioIsDefault: boolean;
  /** The subtitle stream that will show, or null for none. */
  subtitle: SubtitleSource | null;
}

export interface SubtitleSource {
  streamId: number;
  /** Plex codec: srt, subrip, ass, ssa, mov_text, webvtt, vtt, pgs, vobsub, dvd_subtitle, dvb_subtitle. */
  codec: string;
  /** Sidecar file next to the video (has its own `/library/streams/{id}` key). */
  external: boolean;
  forced?: boolean;
  languageCode?: string;
}

/** How the chosen subtitle reaches the screen. */
export type SubtitleDelivery =
  | { kind: "none" }
  /** Fetched as text and rendered by the browser (VTT <track>) or JASSUB (ass). */
  | { kind: "sidecar"; streamId: number; format: "vtt" | "ass"; external: boolean }
  /** Burned into the picture by Plex; forces a transcode. */
  | { kind: "burn"; streamId: number };

/** A Quality menu entry. `maxBitrateKbps: null` means Original. */
export interface QualityChoice {
  /** Matches the label saved in prefs (`Original`, `20 Mbps · 1080p`, ...). */
  label: string;
  /** Shown in the menu. */
  name: string;
  maxBitrateKbps: number | null;
  /** The largest picture a transcode may output. */
  maxWidth: number;
  maxHeight: number;
}

/** Albin's monitor is 1440p: Original transcodes never go above it. */
export const ORIGINAL_TRANSCODE_MAX = { width: 2560, height: 1440, kbps: 40_000 } as const;

export interface PlaybackPlan {
  mode: PlaybackMode;
  subtitles: SubtitleDelivery;
  /** Video codec Plex sends (directStream/transcode) or the file's (directPlay). */
  videoCodecOut: string;
  audioCodecOut: string;
  /** Output size bound for a transcode, else the source size. */
  maxWidth: number;
  maxHeight: number;
  /** Transcode bitrate cap; null outside transcode. */
  maxBitrateKbps: number | null;
  /** Plain-English reasons, e.g. "MKV container: remuxing", shown in the stats overlay. */
  reasons: string[];
}

/** Live numbers from Plex's `/transcode/sessions` for the stats overlay. */
export interface TranscodeSessionInfo {
  videoDecision: "directplay" | "copy" | "transcode" | string;
  audioDecision: "directplay" | "copy" | "transcode" | string;
  subtitleDecision?: string;
  sourceVideoCodec?: string;
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  /** Server is keeping up when >= 1. */
  speed?: number;
  throttled?: boolean;
  transcodeHwRequested?: boolean;
  transcodeHwFullPipeline?: boolean;
  /** Seconds of video transcoded ahead. */
  progress?: number;
}

export interface DecideOptions {
  /** The sidecar subtitle failed to load: burn it in instead (forces a transcode). */
  forceBurn?: boolean;
}
