import { invoke } from "@tauri-apps/api/core";

import { notifyLibraryChanged } from "@/lib/changes";

export interface MatchResult {
  guid: string;
  name: string;
  year?: number | null;
  score?: number | null;
  thumb?: string | null;
  summary?: string | null;
}

export interface Artwork {
  ratingKey: string;
  thumb?: string | null;
  key?: string | null;
  provider?: string | null;
  selected?: boolean | null;
}

/** Things that change what the library shows reload the screens after. */
async function changed<T>(p: Promise<T>) {
  const out = await p;
  notifyLibraryChanged();
  return out;
}

/** Server housekeeping. Only the server owner (or an admin) is let through. */
export const manage = {
  scanLibrary: (section: string, force = false) => invoke<void>("scan_library", { section, force }),
  refresh: (ratingKey: string) => changed(invoke<void>("refresh_item", { ratingKey })),
  analyze: (ratingKey: string) => changed(invoke<void>("analyze_item", { ratingKey })),
  delete: (ratingKey: string) => changed(invoke<void>("delete_item", { ratingKey })),
  findMatches: (ratingKey: string, title: string, year: number | null) =>
    invoke<MatchResult[]>("find_matches", { ratingKey, title, year }),
  applyMatch: (ratingKey: string, result: MatchResult) => changed(invoke<void>("apply_match", { ratingKey, result })),
  edit: (section: number, ratingKey: string, kind: string, fields: [string, string][]) =>
    changed(invoke<void>("edit_item", { section, ratingKey, kind, fields })),
  posters: (ratingKey: string) => invoke<Artwork[]>("item_posters", { ratingKey }),
  setPoster: (ratingKey: string, poster: string) => changed(invoke<void>("set_poster", { ratingKey, poster })),
};

export type ManageDialog = "match" | "edit" | "poster" | "delete";
