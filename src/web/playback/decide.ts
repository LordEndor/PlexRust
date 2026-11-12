import {
  ORIGINAL_TRANSCODE_MAX,
  type BrowserCaps,
  type DecideOptions,
  type LighterOptions,
  type PlaybackPlan,
  type QualityChoice,
  type SourceMedia,
  type SubtitleDelivery,
} from "./types";

const TEXT_SUBS = new Set(["srt", "subrip", "webvtt", "vtt", "mov_text", "text", "ass", "ssa"]);

/** A subtitle the browser can draw itself, if Plex hands out its text. */
export function isTextSubtitle(codec: string): boolean {
  return TEXT_SUBS.has(codec);
}

function subtitleDelivery(source: SourceMedia, opts: DecideOptions): SubtitleDelivery {
  const sub = source.subtitle;
  if (!sub) return { kind: "none" };
  if (opts.forceBurn || !TEXT_SUBS.has(sub.codec)) return { kind: "burn", streamId: sub.streamId };
  const format = sub.codec === "ass" || sub.codec === "ssa" ? "ass" : "vtt";
  return { kind: "sidecar", streamId: sub.streamId, format, external: sub.external };
}

function qualityAllowsOriginal(source: SourceMedia, quality: QualityChoice): boolean {
  if (quality.maxBitrateKbps === null) return true;
  return source.bitrateKbps <= quality.maxBitrateKbps && source.width <= quality.maxWidth && source.height <= quality.maxHeight;
}

function audioOut(source: SourceMedia, caps: BrowserCaps): string {
  if (caps.audioCodecs.has(source.audioCodec)) return source.audioCodec;
  return caps.audioCodecs.has("eac3") && source.audioChannels > 2 ? "eac3" : "aac";
}

/** What this source needs from this browser at this quality. */
function assess(source: SourceMedia, caps: BrowserCaps, quality: QualityChoice, subtitles: SubtitleDelivery) {
  const tenBitOk = source.bitDepth === undefined || source.bitDepth <= 8 || caps.tenBit;
  const videoOk = caps.videoCodecs.has(source.videoCodec) && tenBitOk;
  const hdrProblem = source.hdr && !caps.hdr;
  const audioOk = caps.audioCodecs.has(source.audioCodec);
  const qualityOk = qualityAllowsOriginal(source, quality);
  const burn = subtitles.kind === "burn";
  const playable = videoOk && qualityOk && !burn && !hdrProblem;
  return { tenBitOk, hdrProblem, audioOk, qualityOk, burn, playable, remuxable: playable && caps.hls !== "none" };
}

type Assessment = ReturnType<typeof assess>;

const CODEC_NAMES: Record<string, string> = { h264: "H.264", hevc: "HEVC", av1: "AV1", vp9: "VP9" };

function codecName(codec: string): string {
  return CODEC_NAMES[codec] ?? codec.toUpperCase();
}

function videoLabel(source: SourceMedia): string {
  const res = source.height >= 2000 ? "4K" : source.height > 0 ? `${source.height}p` : "";
  return `${res} ${codecName(source.videoCodec)}`.trim();
}

function transcodeReasons(source: SourceMedia, caps: BrowserCaps, quality: QualityChoice, a: Assessment): string[] {
  const reasons: string[] = [];
  const codec = codecName(source.videoCodec);
  if (a.burn) reasons.push(`${source.subtitle?.codec.toUpperCase() || "These"} subtitles must be burned in`);
  if (a.hdrProblem) reasons.push("HDR on an SDR screen: Plex tone maps");
  if (!caps.videoCodecs.has(source.videoCodec)) reasons.push(`${codec} not supported by this browser`);
  else if (!a.tenBitOk) reasons.push(`10-bit ${codec} not supported by this browser`);
  if (!a.qualityOk) reasons.push(`${quality.name} is below the original: re-encoding`);
  if (a.playable && caps.hls === "none") reasons.push("This browser can't play HLS");
  if (reasons.length === 0) reasons.push("Re-encoding to play in this browser");
  return reasons;
}

/**
 * The bitrate cap for an Original transcode. H.264 needs two to three times
 * the bits of HEVC or AV1, and asking for more than that only makes Plex's
 * encoder work harder for nothing.
 */
function originalCapKbps(source: SourceMedia): number {
  if (source.bitrateKbps <= 0) return ORIGINAL_TRANSCODE_MAX.kbps;
  return Math.min(ORIGINAL_TRANSCODE_MAX.kbps, Math.max(8000, source.bitrateKbps * 3));
}

function transcodePlan(
  source: SourceMedia,
  quality: QualityChoice,
  subtitles: SubtitleDelivery,
  reasons: string[],
  keepSidecar = false,
): PlaybackPlan {
  const original = quality.maxBitrateKbps === null;
  const width = original ? ORIGINAL_TRANSCODE_MAX.width : quality.maxWidth;
  const height = original ? ORIGINAL_TRANSCODE_MAX.height : quality.maxHeight;
  // Plex only hands out sidecar subtitle files as text; embedded ones are
  // burned in, which costs nothing extra when the video is re-encoded anyway.
  // (Unless that re-encode turned out too heavy: see lighterPlans.)
  if (!keepSidecar && subtitles.kind === "sidecar" && !subtitles.external) subtitles = { kind: "burn", streamId: subtitles.streamId };
  return {
    mode: "transcode",
    subtitles,
    videoCodecOut: "h264",
    // MPEG-TS through hls.js: AAC is the one codec that always works.
    audioCodecOut: "aac",
    maxWidth: source.width > 0 ? Math.min(width, source.width) : width,
    maxHeight: source.height > 0 ? Math.min(height, source.height) : height,
    maxBitrateKbps: original ? originalCapKbps(source) : quality.maxBitrateKbps,
    reasons,
  };
}

function directStreamPlan(source: SourceMedia, caps: BrowserCaps, subtitles: SubtitleDelivery, a: Assessment, reasons: string[]): PlaybackPlan {
  const audioCodecOut = audioOut(source, caps);
  const why = [...reasons];
  if (!a.audioOk) why.push(`${source.audioCodec.toUpperCase() || "Audio"} not supported by this browser: converting audio to ${audioCodecOut.toUpperCase()}`);
  return {
    mode: "directStream",
    subtitles,
    videoCodecOut: source.videoCodec,
    audioCodecOut,
    maxWidth: source.width,
    maxHeight: source.height,
    maxBitrateKbps: null,
    reasons: why,
  };
}

function directPlayPlan(source: SourceMedia, subtitles: SubtitleDelivery): PlaybackPlan {
  return {
    mode: "directPlay",
    subtitles,
    videoCodecOut: source.videoCodec,
    audioCodecOut: source.audioCodec,
    maxWidth: source.width,
    maxHeight: source.height,
    maxBitrateKbps: null,
    reasons: [`Source is ${videoLabel(source)}: playing the file as is`],
  };
}

function remuxReasons(source: SourceMedia, caps: BrowserCaps): string[] {
  if (!caps.containers.has(source.container)) return [`${source.container.toUpperCase()} container: remuxing to fMP4`];
  if (!source.audioIsDefault) return ["Picked audio track isn't the first: remuxing"];
  return [];
}

/** The best way to play `source` in this browser at this quality. */
export function decide(source: SourceMedia, caps: BrowserCaps, quality: QualityChoice, opts: DecideOptions = {}): PlaybackPlan {
  const subtitles = subtitleDelivery(source, opts);
  const a = assess(source, caps, quality, subtitles);

  if (a.playable && a.audioOk && caps.containers.has(source.container) && source.audioIsDefault) {
    return directPlayPlan(source, subtitles);
  }
  if (a.remuxable) return directStreamPlan(source, caps, subtitles, a, remuxReasons(source, caps));
  return transcodePlan(source, quality, subtitles, transcodeReasons(source, caps, quality, a));
}

/** The next step down after `plan` failed to play, or null when nothing is left. */
export function fallback(plan: PlaybackPlan, source: SourceMedia, caps: BrowserCaps, quality: QualityChoice): PlaybackPlan | null {
  if (plan.mode === "transcode") return null;
  const subtitles = plan.subtitles;
  const a = assess(source, caps, quality, subtitles);

  if (plan.mode === "directPlay") {
    if (a.remuxable) return directStreamPlan(source, caps, subtitles, a, ["Direct play failed: remuxing to fMP4 instead"]);
    return transcodePlan(source, quality, subtitles, ["Direct play failed: re-encoding instead", ...transcodeReasons(source, caps, quality, a)]);
  }
  return transcodePlan(source, quality, subtitles, ["Direct stream failed: re-encoding instead"]);
}

const STALLED = "Plex couldn't keep up with the re-encode";

/**
 * Lighter ways to play `source` after its transcode stalled (Plex's transcoder
 * too slow or stuck), in the order to try them. Each is easier on the server
 * than the last transcode: text subtitles drawn by the browser instead of
 * burned in (burning takes the video off the GPU), then 1080p, then the
 * untouched picture remuxed (no re-encode at all; an SDR screen leaves the HDR
 * tone mapping to the browser), then 720p, and finally the untouched picture
 * without a subtitle that can only be burned in. Empty when the normal plan
 * isn't a transcode.
 */
export function lighterPlans(
  source: SourceMedia,
  caps: BrowserCaps,
  quality: QualityChoice,
  opts: LighterOptions = {},
): PlaybackPlan[] {
  const normal = decide(source, caps, quality, { forceBurn: opts.sidecarFailed });
  if (normal.mode !== "transcode") return [];

  const text = subtitleDelivery(source, { forceBurn: opts.sidecarFailed });
  const a = assess(source, caps, quality, text);
  const burnsText = normal.subtitles.kind === "burn" && text.kind === "sidecar";
  const plans: PlaybackPlan[] = [];

  if (burnsText) {
    plans.push({
      ...normal,
      subtitles: text,
      step: "subs",
      reasons: [`${STALLED}: subtitles are drawn by the browser instead of burned in`],
    });
  }

  const smaller = (step: "1080p" | "720p", width: number, height: number, kbps: number) => {
    if (normal.maxHeight <= height && normal.maxWidth <= width) return;
    const q: QualityChoice = { label: step, name: step, maxBitrateKbps: Math.min(kbps, normal.maxBitrateKbps ?? kbps), maxWidth: width, maxHeight: height };
    plans.push({ ...transcodePlan(source, q, text, [`${STALLED}: lowered to ${step}`], true), step });
  };

  smaller("1080p", 1920, 1080, 10_000);

  // Only at Original: a lower quality was picked to save bandwidth, and the
  // untouched file would ignore that.
  const decodes = caps.videoCodecs.has(source.videoCodec) && a.tenBitOk && caps.hls !== "none";
  if (quality.maxBitrateKbps === null && decodes && text.kind !== "burn") {
    const why = a.hdrProblem
      ? `${STALLED}: playing the original picture, so HDR colours are up to this browser`
      : `${STALLED}: playing the original picture`;
    plans.push({ ...directStreamPlan(source, caps, text, a, [why]), step: "original" });
  }

  smaller("720p", 1280, 720, 4000);

  // Last resort: a subtitle that has to be burned in needs a re-encode, and
  // this server can't do one. The picture without it beats no picture.
  if (quality.maxBitrateKbps === null && decodes && text.kind === "burn") {
    plans.push({
      ...directStreamPlan(source, caps, { kind: "none" }, a, [`${STALLED}: playing the original picture without subtitles, which Plex would have to burn in`]),
      step: "nosubs",
    });
  }
  return plans;
}
