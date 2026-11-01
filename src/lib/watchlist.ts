import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { Metadata } from "@/lib/api";

export interface WatchlistItem {
  /** The title as Plex's Discover service describes it; its thumb is a full URL. */
  item: Metadata;
  /** The same title on this server, when it's there to play. */
  local?: Metadata | null;
  /** For requesting it through Seerr when it isn't. */
  tmdbId?: number | null;
}

/** The Home row's id, for ordering and hiding it like Plex's own rows. */
export const WATCHLIST_HUB = "plexrust.watchlist";

const EVENT = "plexrust:watchlist-changed";

export const watchlist = {
  list: () => invoke<WatchlistItem[]>("watchlist"),
  set: async (guid: string, on: boolean) => {
    await invoke<void>("watchlist_set", { guid, on });
    window.dispatchEvent(new Event(EVENT));
  },
  has: (guid: string) => invoke<boolean>("watchlist_has", { guid }),
};

/** Only titles matched by Plex's agent have a guid the watchlist knows. */
export function canWatchlist(item: Metadata) {
  return (item.type === "movie" || item.type === "show") && !!item.guid?.startsWith("plex://");
}

/** Runs `onChange` after something is added to or taken off the watchlist. */
export function useWatchlistChanged(onChange: () => void) {
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    const handler = () => latest.current();
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);
}
