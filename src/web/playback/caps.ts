import Hls from "hls.js";
import type { BrowserCaps } from "./types";

let cached: Promise<BrowserCaps> | null = null;

/** Probes what this browser decodes. Cached after the first call. */
export function detectCaps(): Promise<BrowserCaps> {
  cached ??= Promise.resolve().then(probe);
  return cached;
}

function mse(type: string): boolean {
  try {
    return typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(type);
  } catch {
    return false;
  }
}

function probe(): BrowserCaps {
  const videoCodecs = new Set<string>();
  if (mse('video/mp4; codecs="avc1.640033"')) videoCodecs.add("h264");
  if (mse('video/mp4; codecs="hvc1.1.6.L153.B0"') || mse('video/mp4; codecs="hev1.1.6.L153.B0"')) videoCodecs.add("hevc");
  if (mse('video/mp4; codecs="av01.0.08M.08"')) videoCodecs.add("av1");
  if (mse('video/mp4; codecs="vp09.00.40.08"')) videoCodecs.add("vp9");

  const tenBit =
    mse('video/mp4; codecs="hvc1.2.4.L153.B0"') ||
    mse('video/mp4; codecs="hev1.2.4.L153.B0"') ||
    mse('video/mp4; codecs="av01.0.08M.10"');

  let hdr = false;
  try {
    hdr = tenBit && typeof matchMedia === "function" && matchMedia("(dynamic-range: high)").matches;
  } catch {
    hdr = false;
  }

  const video = document.createElement("video");
  const can = (type: string) => video.canPlayType(type) !== "";

  const audioCodecs = new Set<string>();
  if (mse('audio/mp4; codecs="mp4a.40.2"')) audioCodecs.add("aac");
  if (can("audio/mpeg") || mse('audio/mp4; codecs="mp4a.6B"')) audioCodecs.add("mp3");
  if (mse('audio/mp4; codecs="opus"')) audioCodecs.add("opus");
  if (mse('audio/mp4; codecs="flac"')) audioCodecs.add("flac");
  if (mse('audio/mp4; codecs="ac-3"')) audioCodecs.add("ac3");
  if (mse('audio/mp4; codecs="ec-3"')) audioCodecs.add("eac3");

  const containers = new Set<string>();
  if (can("video/mp4")) ["mp4", "m4v", "mov"].forEach((c) => containers.add(c));
  if (can("video/webm")) containers.add("webm");

  const hls: BrowserCaps["hls"] = Hls.isSupported() ? "mse" : can("application/vnd.apple.mpegurl") ? "native" : "none";

  return { videoCodecs, tenBit, hdr, audioCodecs, containers, hls };
}
