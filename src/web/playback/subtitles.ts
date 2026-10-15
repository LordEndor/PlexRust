import { subtitleUrl } from "../plex";
import { srtToVtt } from "./srt";
import type { SubtitleDelivery } from "./types";

const STYLE_ID = "plexrust-cue-style";

function ensureCueStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `video::cue {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: clamp(1.1rem, 2.4vw, 1.6rem);
  line-height: 1.3;
  color: #fff;
  background-color: rgba(0, 0, 0, 0.55);
  text-shadow: 0 0 3px #000, 0 1px 2px #000;
}`;
  document.head.appendChild(style);
}

type Format = "vtt" | "ass" | "srt";

function detectFormat(text: string): Format {
  const t = text.replace(/^﻿/, "");
  if (t.trimStart().startsWith("WEBVTT")) return "vtt";
  if (/\[Script Info\]|\[Events\]/i.test(t)) return "ass";
  return "srt";
}

/**
 * Shows a sidecar subtitle on `video`: WebVTT through a <track>, ASS/SSA through
 * JASSUB. Does nothing for `none` and `burn` (Plex draws those). Resolves to a
 * cleanup function. Rejects when the subtitle can't be fetched or parsed, so the
 * player can fall back to burning it in.
 */
export async function attachSubtitles(video: HTMLVideoElement, delivery: SubtitleDelivery): Promise<() => void> {
  if (delivery.kind !== "sidecar") return () => {};

  const res = await fetch(subtitleUrl(delivery.streamId, delivery.format, delivery.external));
  if (!res.ok) throw new Error(`Subtitle download failed (${res.status})`);
  const text = await res.text();
  if (!text.trim()) throw new Error("Subtitle file is empty");

  const format = detectFormat(text);
  if (format === "ass") return attachAss(video, text);
  return attachVtt(video, format === "vtt" ? text.replace(/^﻿/, "") : srtToVtt(text));
}

function attachVtt(video: HTMLVideoElement, vtt: string): () => void {
  ensureCueStyle();
  const url = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
  const track = document.createElement("track");
  track.kind = "subtitles";
  track.default = true;
  track.src = url;
  const show = () => {
    track.track.mode = "showing";
  };
  track.addEventListener("load", show);
  video.appendChild(track);
  show();
  return () => {
    track.removeEventListener("load", show);
    track.track.mode = "disabled";
    track.remove();
    URL.revokeObjectURL(url);
  };
}

async function attachAss(video: HTMLVideoElement, content: string): Promise<() => void> {
  // Dynamic imports keep JASSUB (and its worker and wasm) out of the main bundle.
  const [{ default: JASSUB }, worker, wasm, modernWasm] = await Promise.all([
    import("jassub"),
    import("jassub/dist/worker/worker.js?worker&url"),
    import("jassub/dist/wasm/jassub-worker.wasm?url"),
    import("jassub/dist/wasm/jassub-worker-modern.wasm?url"),
  ]);
  const instance = new JASSUB({
    video,
    subContent: content,
    workerUrl: worker.default,
    wasmUrl: wasm.default,
    modernWasmUrl: modernWasm.default,
  });
  try {
    await instance.ready;
  } catch (e) {
    instance.destroy().catch(() => {});
    throw e;
  }
  return () => {
    instance.destroy().catch(() => {});
  };
}
