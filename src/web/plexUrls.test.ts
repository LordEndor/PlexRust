import { describe, expect, it } from "vitest";
import { clientProfileExtra } from "./plex";
import type { BrowserCaps, PlaybackPlan } from "./playback/types";

const caps = (over: Partial<BrowserCaps> = {}): BrowserCaps => ({
  videoCodecs: new Set(["h264", "hevc"]),
  tenBit: true,
  hdr: false,
  audioCodecs: new Set(["aac", "opus", "mp3"]),
  containers: new Set(["mp4"]),
  hls: "mse",
  ...over,
});

const plan = (over: Partial<PlaybackPlan> = {}): PlaybackPlan => ({
  mode: "directStream",
  subtitles: { kind: "none" },
  videoCodecOut: "hevc",
  audioCodecOut: "opus",
  maxWidth: 3840,
  maxHeight: 2160,
  maxBitrateKbps: null,
  reasons: [],
  ...over,
});

describe("clientProfileExtra", () => {
  it("direct stream uses fMP4, source codec, no size limits", () => {
    const s = clientProfileExtra(plan(), caps());
    expect(s).toContain("container=mp4&videoCodec=hevc&audioCodec=opus,aac&replace=true");
    expect(s).not.toContain("video.width");
    expect(s).toContain("video.bitDepth&value=10");
    expect(s.split("+")).toHaveLength(4);
  });

  it("transcode uses mpegts h264 with size limits and dedupes audio", () => {
    const s = clientProfileExtra(
      plan({ mode: "transcode", videoCodecOut: "h264", audioCodecOut: "aac", maxWidth: 1920, maxHeight: 1080, maxBitrateKbps: 8000 }),
      caps(),
    );
    expect(s).toContain("container=mpegts&videoCodec=h264&audioCodec=aac&replace=true");
    expect(s).toContain("video.width&value=1920");
    expect(s).toContain("video.height&value=1080");
    expect(s).not.toContain("bitDepth");
  });

  it("falls back to 8-bit HEVC and drops unsupported audio", () => {
    const s = clientProfileExtra(plan({ audioCodecOut: "truehd" }), caps({ tenBit: false }));
    expect(s).toContain("video.bitDepth&value=8");
    expect(s).toContain("audioCodec=aac&");
  });
});
