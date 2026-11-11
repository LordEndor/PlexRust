import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import type { Metadata } from "@/lib/api";
import { isUpcoming, missingEpisodes, missingSeasons, releaseLabel, tmdbIdFromGuids } from "@/lib/missing";

const plex = (index: number) => ({ index }) as Metadata;

describe("missing episodes and seasons", () => {
  it("reads the TMDB id from Plex guids", () => {
    expect(tmdbIdFromGuids({ Guid: [{ id: "imdb://tt0386676" }, { id: "tmdb://2316" }] })).toBe(2316);
    expect(tmdbIdFromGuids({ Guid: [{ id: "tvdb://73244" }] })).toBeNull();
    expect(tmdbIdFromGuids({})).toBeNull();
  });

  it("lists seasons the server doesn't have, without specials or empty undated ones", () => {
    const seasons = [
      { seasonNumber: 0, name: "Specials", episodeCount: 5 },
      { seasonNumber: 1, name: "Season 1", episodeCount: 6 },
      { seasonNumber: 2, name: "Season 2", episodeCount: 22 },
      { seasonNumber: 3, name: "Season 3", episodeCount: 0, airDate: "2027-01-10" },
      { seasonNumber: 4, name: "Season 4", episodeCount: 0 },
    ];
    expect(missingSeasons([plex(1)], seasons).map((s) => s.seasonNumber)).toEqual([2, 3]);
  });

  it("lists episodes the server doesn't have", () => {
    const episodes = [1, 2, 3, 4].map((n) => ({ episodeNumber: n, seasonNumber: 1, name: `E${n}` }));
    expect(missingEpisodes([plex(1), plex(3)], episodes).map((e) => e.episodeNumber)).toEqual([2, 4]);
  });

  it("says whether a date is still to come", () => {
    const today = new Date(2026, 10, 11, 15, 0);
    expect(isUpcoming("2026-11-11", today)).toBe(true);
    expect(isUpcoming("2026-11-10", today)).toBe(false);
    expect(releaseLabel("2026-12-03", today)).toMatch(/^Airs /);
    expect(releaseLabel("2024-03-01", today)).toMatch(/^Aired /);
    expect(releaseLabel(null, today)).toBe("Air date not announced");
  });
});
