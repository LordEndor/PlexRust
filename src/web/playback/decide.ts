import {
  ORIGINAL_TRANSCODE_MAX,
  type BrowserCaps,
  type DecideOptions,
  type PlaybackPlan,
  type QualityChoice,
  type SourceMedia,
  type SubtitleDelivery,
} from "./types";

const TEXT_SUBS = new Set(["srt", "subrip", "webvtt", "vtt", "mov_text", "text", "ass", "ssa"]);

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

function transcodePlan(source: SourceMedia, caps: BrowserCaps, quality: QualityChoice, subtitles: SubtitleDelivery, reasons: string[]): PlaybackPlan {
  const original = quality.maxBitrateKbps === null;
  const width = original ? ORIGINAL_TRANSCODE_MAX.width : quality.maxWidth;
  const height = original ? ORIGINAL_TRANSCODE_MAX.height : quality.maxHeight;
  return {
    mode: "transcode",
    subtitles,
    videoCodecOut: "h264",
    audioCodecOut: audioOut(source, caps),
    maxWidth: source.width > 0 ? Math.min(width, source.width) : width,
    maxHeight: source.height > 0 ? Math.min(height, source.height) : height,
    maxBitrateKbps: original ? ORIGINAL_TRANSCODE_MAX.kbps : quality.maxBitrateKbps,
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
  return transcodePlan(source, caps, quality, subtitles, transcodeReasons(source, caps, quality, a));
}

/** The next step down after `plan` failed to play, or null when nothing is left. */
export function fallback(plan: PlaybackPlan, source: SourceMedia, caps: BrowserCaps, quality: QualityChoice): PlaybackPlan | null {
  if (plan.mode === "transcode") return null;
  const subtitles = plan.subtitles;
  const a = assess(source, caps, quality, subtitles);

  if (plan.mode === "directPlay") {
    if (a.remuxable) return directStreamPlan(source, caps, subtitles, a, ["Direct play failed: remuxing to fMP4 instead"]);
    return transcodePlan(source, caps, quality, subtitles, ["Direct play failed: re-encoding instead", ...transcodeReasons(source, caps, quality, a)]);
  }
  return transcodePlan(source, caps, quality, subtitles, ["Direct stream failed: re-encoding instead"]);
}
