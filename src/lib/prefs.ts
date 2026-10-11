import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type SkipMode = "auto" | "button" | "off";

export interface Prefs {
  skipIntro: SkipMode;
  skipCredits: SkipMode;
  /** A label from QUALITIES. */
  quality: string;
  /** mpv language list such as "sv,swe"; empty keeps the file's default. */
  audioLanguage: string;
  /** As above, or "off" to start with subtitles off. */
  subtitleLanguage: string;
}

export const DEFAULT_PREFS: Prefs = {
  skipIntro: "auto",
  skipCredits: "auto",
  quality: "Original",
  audioLanguage: "",
  subtitleLanguage: "",
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
