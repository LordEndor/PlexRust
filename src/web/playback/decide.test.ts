import { describe, it, expect } from "vitest";
import { decide, fallback } from "./decide";
import type { BrowserCaps, QualityChoice, SourceMedia, SubtitleSource } from "./types";

const original: QualityChoice = { label: "Original", name: "Original", maxBitrateKbps: null, maxWidth: 3840, maxHeight: 2160 };
const eightMbps: QualityChoice = { label: "8 Mbps · 1080p", name: "8 Mbps · 1080p", maxBitrateKbps: 8000, maxWidth: 1920, maxHeight: 1080 };

const chrome: BrowserCaps = {
  videoCodecs: new Set(["h264", "vp9", "av1"]),
  tenBit: false,
  hdr: false,
  audioCodecs: new Set(["aac", "mp3", "opus", "flac"]),
  containers: new Set(["mp4", "m4v", "mov", "webm"]),
  hls: "mse",
};
const edge: BrowserCaps = {
  ...chrome,
  videoCodecs: new Set(["h264", "hevc", "vp9", "av1"]),
  tenBit: true,
  audioCodecs: new Set([...chrome.audioCodecs, "ac3", "eac3"]),
};

const mp4: SourceMedia = {
  partKey: "/library/parts/1/1/file.mp4",
  partId: 1,
  container: "mp4",
  videoCodec: "h264",
  bitDepth: 8,
  hdr: false,
  dolbyVision: false,
  width: 1920,
  height: 1080,
  bitrateKbps: 5000,
  audioCodec: "aac",
  audioChannels: 2,
  audioIsDefault: true,
  subtitle: null,
};
const hevcMkv: SourceMedia = {
  ...mp4,
  container: "mkv",
  videoCodec: "hevc",
  bitDepth: 10,
  bitrateKbps: 30000,
  audioCodec: "eac3",
  audioChannels: 6,
};
const sub = (codec: string, external = false): SubtitleSource => ({ streamId: 9, codec, external });

describe("decide", () => {
  it("direct plays a 1080p H.264 MP4 with AAC", () => {
    const plan = decide(mp4, chrome, original);
    expect(plan.mode).toBe("directPlay");
    expect(plan.maxBitrateKbps).toBeNull();
    expect(plan.reasons[0]).toContain("1080p H.264");
  });

  it("direct streams HEVC 10-bit MKV, keeping EAC3 on Edge-like caps", () => {
    const plan = decide(hevcMkv, edge, original);
    expect(plan.mode).toBe("directStream");
    expect(plan.videoCodecOut).toBe("hevc");
    expect(plan.audioCodecOut).toBe("eac3");
    expect(plan.reasons).toContain("MKV container: remuxing to fMP4");
  });

  it("converts EAC3 to AAC on Chrome-like caps without EAC3", () => {
    const plan = decide(hevcMkv, { ...edge, audioCodecs: chrome.audioCodecs }, original);
    expect(plan.mode).toBe("directStream");
    expect(plan.audioCodecOut).toBe("aac");
  });

  it("transcodes HEVC to H.264 capped at 1440p when the browser lacks HEVC", () => {
    const src = { ...hevcMkv, width: 3840, height: 2160 };
    const plan = decide(src, chrome, original);
    expect(plan.mode).toBe("transcode");
    expect(plan.videoCodecOut).toBe("h264");
    expect(plan.maxWidth).toBe(2560);
    expect(plan.maxHeight).toBe(1440);
    expect(plan.maxBitrateKbps).toBe(40000);
    expect(plan.reasons).toContain("HEVC not supported by this browser");
  });

  it("never transcodes larger than the source", () => {
    const plan = decide({ ...hevcMkv, width: 1280, height: 720 }, chrome, original);
    expect(plan.maxWidth).toBe(1280);
    expect(plan.maxHeight).toBe(720);
  });

  it("transcodes 4K HDR on an SDR screen", () => {
    const src = { ...hevcMkv, width: 3840, height: 2160, hdr: true };
    const plan = decide(src, edge, original);
    expect(plan.mode).toBe("transcode");
    expect(plan.reasons).toContain("HDR on an SDR screen: Plex tone maps");
  });

  it("direct streams HDR when the screen shows it", () => {
    const plan = decide({ ...hevcMkv, hdr: true }, { ...edge, hdr: true }, original);
    expect(plan.mode).toBe("directStream");
  });

  it("burns PGS subtitles and transcodes", () => {
    const plan = decide({ ...mp4, subtitle: sub("pgs") }, chrome, original);
    expect(plan.mode).toBe("transcode");
    expect(plan.subtitles).toEqual({ kind: "burn", streamId: 9 });
  });

  it("burns unknown subtitle codecs", () => {
    expect(decide({ ...mp4, subtitle: sub("mystery") }, chrome, original).subtitles.kind).toBe("burn");
  });

  it("uses a VTT sidecar for SRT and still direct plays", () => {
    const plan = decide({ ...mp4, subtitle: sub("srt", true) }, chrome, original);
    expect(plan.mode).toBe("directPlay");
    expect(plan.subtitles).toEqual({ kind: "sidecar", streamId: 9, format: "vtt", external: true });
  });

  it("uses an ASS sidecar for ASS", () => {
    const plan = decide({ ...mp4, subtitle: sub("ass") }, chrome, original);
    expect(plan.subtitles).toEqual({ kind: "sidecar", streamId: 9, format: "ass", external: false });
  });

  it("direct streams when the picked audio is not the default track", () => {
    const plan = decide({ ...mp4, audioIsDefault: false }, chrome, original);
    expect(plan.mode).toBe("directStream");
  });

  it("transcodes a 30 Mbps file at 8 Mbps 1080p", () => {
    const plan = decide({ ...mp4, bitrateKbps: 30000 }, chrome, eightMbps);
    expect(plan.mode).toBe("transcode");
    expect(plan.maxBitrateKbps).toBe(8000);
    expect(plan.maxWidth).toBe(1920);
    expect(plan.maxHeight).toBe(1080);
  });

  it("direct plays a 5 Mbps 1080p file at 8 Mbps 1080p", () => {
    expect(decide(mp4, chrome, eightMbps).mode).toBe("directPlay");
  });

  it("transcodes when a 4K file exceeds the quality's size", () => {
    const plan = decide({ ...mp4, width: 3840, height: 2160 }, chrome, eightMbps);
    expect(plan.mode).toBe("transcode");
  });

  it("forceBurn burns a text subtitle and transcodes", () => {
    const plan = decide({ ...mp4, subtitle: sub("srt") }, chrome, original, { forceBurn: true });
    expect(plan.mode).toBe("transcode");
    expect(plan.subtitles).toEqual({ kind: "burn", streamId: 9 });
  });

  it("transcodes when HLS is unavailable and the file can't direct play", () => {
    const plan = decide(hevcMkv, { ...edge, hls: "none" }, original);
    expect(plan.mode).toBe("transcode");
  });
});

describe("fallback", () => {
  it("steps directPlay -> directStream -> transcode -> null", () => {
    const first = decide(mp4, chrome, original);
    expect(first.mode).toBe("directPlay");
    const second = fallback(first, mp4, chrome, original);
    expect(second?.mode).toBe("directStream");
    expect(second?.reasons.some((r) => r.startsWith("Direct play failed"))).toBe(true);
    const third = fallback(second!, mp4, chrome, original);
    expect(third?.mode).toBe("transcode");
    expect(third?.reasons.some((r) => r.startsWith("Direct stream failed"))).toBe(true);
    expect(fallback(third!, mp4, chrome, original)).toBeNull();
  });

  it("goes straight to transcode when direct stream isn't possible", () => {
    const noHls = { ...chrome, hls: "none" as const };
    const plan = decide(mp4, noHls, original);
    expect(fallback(plan, mp4, noHls, original)?.mode).toBe("transcode");
  });

  it("keeps the subtitles of the failed plan", () => {
    const src = { ...mp4, subtitle: sub("srt", true) };
    const plan = decide(src, chrome, original);
    expect(fallback(plan, src, chrome, original)?.subtitles).toEqual(plan.subtitles);
  });
});
