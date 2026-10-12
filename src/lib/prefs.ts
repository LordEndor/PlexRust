import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { CustomRow } from "@/lib/customRows";

export type SkipMode = "auto" | "button" | "off";

export interface Prefs {
  skipIntro: SkipMode;
  skipCredits: SkipMode;
  /** Recaps and outros are found by chapter name; Plex doesn't detect them. */
  skipRecap: SkipMode;
  skipOutro: SkipMode;
  /** A label from QUALITIES. */
  quality: string;
  /** mpv language list such as "sv,swe"; empty keeps the file's default. */
  audioLanguage: string;
  /** As above, or "off" to start with subtitles off. */
  subtitleLanguage: string;
  /** A key from ACCENTS. */
  accent: string;
  /** A key from POSTER_SIZES. */
  posterSize: string;
  /** The rotating banner at the top of Home. */
  showFeatured: boolean;
  /** Home rows by hub identifier, in the order picked on the settings page. */
  hubOrder: string[];
  /** Home rows turned off, by hub identifier. */
  hiddenHubs: string[];
  /** The last sort picked in each library, such as `addedAt:desc`, by section key. */
  librarySorts: Record<string, string>;
  /** Home rows made on the settings page, such as "Highest rated movies". */
  customRows: CustomRow[];
}

export const DEFAULT_PREFS: Prefs = {
  skipIntro: "auto",
  skipCredits: "auto",
  skipRecap: "auto",
  skipOutro: "auto",
  quality: "Original",
  audioLanguage: "",
  subtitleLanguage: "",
  accent: "amber",
  posterSize: "medium",
  showFeatured: true,
  hubOrder: [],
  hiddenHubs: [],
  librarySorts: {},
  customRows: [],
};

// One copy for the whole app, so the settings page and the player agree.
let current: Prefs | null = null;
let loading: Promise<Prefs> | null = null;
const listeners = new Set<(p: Prefs) => void>();

export function loadPrefs(): Promise<Prefs> {
  if (current) return Promise.resolve(current);
  loading ??= invoke<Prefs>("get_prefs")
    .catch(() => DEFAULT_PREFS)
    .then((p) => (current = { ...DEFAULT_PREFS, ...p }));
  return loading;
}

export async function savePrefs(patch: Partial<Prefs>) {
  const next = { ...(await loadPrefs()), ...patch };
  current = next;
  listeners.forEach((l) => l(next));
  await invoke("set_prefs", { prefs: next });
}

export function usePrefs(): Prefs | null {
  const [prefs, setPrefs] = useState(current);
  useEffect(() => {
    listeners.add(setPrefs);
    loadPrefs().then(setPrefs);
    return () => {
      listeners.delete(setPrefs);
    };
  }, []);
  return prefs;
}

/** Languages offered on the settings page, as mpv language lists. */
export const LANGUAGES = [
  { label: "English", value: "en,eng" },
  { label: "Swedish", value: "sv,swe" },
  { label: "Norwegian", value: "no,nor,nb,nob" },
  { label: "Danish", value: "da,dan" },
  { label: "Finnish", value: "fi,fin" },
  { label: "German", value: "de,ger,deu" },
  { label: "French", value: "fr,fre,fra" },
  { label: "Spanish", value: "es,spa" },
  { label: "Italian", value: "it,ita" },
  { label: "Japanese", value: "ja,jpn" },
];

/** Accent colors for buttons, progress bars and highlights. All light enough for dark text on top. */
export const ACCENTS = [
  { key: "amber", label: "Amber", color: "oklch(0.795 0.184 86.047)" },
  { key: "orange", label: "Orange", color: "oklch(0.75 0.18 55)" },
  { key: "red", label: "Red", color: "oklch(0.7 0.19 22)" },
  { key: "pink", label: "Pink", color: "oklch(0.75 0.17 350)" },
  { key: "purple", label: "Purple", color: "oklch(0.72 0.16 300)" },
  { key: "blue", label: "Blue", color: "oklch(0.72 0.15 250)" },
  { key: "teal", label: "Teal", color: "oklch(0.78 0.13 185)" },
  { key: "green", label: "Green", color: "oklch(0.78 0.17 145)" },
];

/** Poster widths in pixels: portrait posters, and wide Continue Watching thumbnails. */
export const POSTER_SIZES = [
  { key: "small", label: "Small", poster: 130, wide: 240 },
  { key: "medium", label: "Medium", poster: 160, wide: 288 },
  { key: "large", label: "Large", poster: 200, wide: 352 },
];

export function posterSize(prefs: Prefs | null) {
  return POSTER_SIZES.find((s) => s.key === prefs?.posterSize) ?? POSTER_SIZES[1];
}

/** Keeps the theme's accent in step with the setting. */
export function useAccent() {
  const prefs = usePrefs();
  useEffect(() => {
    const accent = ACCENTS.find((a) => a.key === prefs?.accent) ?? ACCENTS[0];
    const root = document.documentElement.style;
    root.setProperty("--primary", accent.color);
    root.setProperty("--ring", accent.color);
  }, [prefs?.accent]);
}

/** Hubs in the picked order (new ones keep Plex's order, after the picked ones), without hidden ones unless asked. */
export function arrangeHubs<T extends { hubIdentifier: string }>(
  hubs: T[],
  prefs: Prefs | null,
  keepHidden = false,
): T[] {
  const order = prefs?.hubOrder ?? [];
  const rank = (h: T) => {
    const i = order.indexOf(h.hubIdentifier);
    return i < 0 ? order.length : i;
  };
  const sorted = hubs.map((h, i) => ({ h, i })).sort((a, b) => rank(a.h) - rank(b.h) || a.i - b.i);
  return sorted.map((x) => x.h).filter((h) => keepHidden || !prefs?.hiddenHubs.includes(h.hubIdentifier));
}
