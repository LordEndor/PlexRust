import { describe, expect, it } from "vitest";
import { sourceKind, STALL_SECS, tickStarved } from "./lighter";
import type { SourceMedia } from "./types";

const file: SourceMedia = {
  partKey: "/library/parts/1/1/file.mkv",
  partId: 1,
  container: "mkv",
  videoCodec: "hevc",
  bitDepth: 10,
  hdr: true,
  dolbyVision: true,
  width: 3840,
  height: 2160,
  bitrateKbps: 6800,
  audioCodec: "eac3",
  audioChannels: 6,
  audioIsDefault: true,
  subtitle: null,
};

describe("tickStarved", () => {
  const run = (pattern: boolean[], secs: number) => {
    let starved = 0;
    for (let i = 0; i < secs; i++) starved = tickStarved(starved, pattern[i % pattern.length]);
    return starved;
  };

  it("trips after a quarter minute of a stuck transcode", () => {
    expect(run([true], STALL_SECS)).toBe(STALL_SECS);
  });

  it("trips within a minute when Plex runs at half speed", () => {
    expect(run([true, false], 60)).toBeGreaterThanOrEqual(STALL_SECS);
  });

  it("never trips on a short wait followed by smooth playback", () => {
    expect(run([true, true, true, true, true, true, true, true, ...Array(60).fill(false)], 68)).toBe(0);
  });
});

describe("sourceKind", () => {
  it("groups episodes of the same release, and separates subtitles on from off", () => {
    expect(sourceKind(file)).toBe(sourceKind({ ...file, partId: 2, bitrateKbps: 7200 }));
    expect(sourceKind(file)).not.toBe(sourceKind({ ...file, subtitle: { streamId: 3, codec: "srt", external: false } }));
  });
});
