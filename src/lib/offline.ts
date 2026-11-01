import { useEffect, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

import type { Metadata } from "@/lib/api";

/** The browser build can't save files for offline use. */
export const OFFLINE_SUPPORTED = import.meta.env.MODE !== "web";

export type OfflineStatus = "queued" | "downloading" | "done" | "failed";

export interface OfflineItem {
  ratingKey: string;
  serverId: string;
  item: Metadata;
  file: string;
  poster?: string | null;
  status: OfflineStatus;
  error?: string | null;
  size: number;
  downloaded: number;
  viewOffsetMs: number;
  watched: boolean;
  pendingSync: boolean;
  addedAt: number;
}

const EVENT = "plexrust:offline-changed";
const changed = () => window.dispatchEvent(new Event(EVENT));

export const offline = {
  list: () => invoke<OfflineItem[]>("offline_list"),
  /** Queues a movie or episode, or every episode of a season or show. */
  download: async (ratingKey: string) => {
    const n = await invoke<number>("offline_download", { ratingKey });
    changed();
    return n;
  },
  remove: async (serverId: string, ratingKey: string) => {
    await invoke<void>("offline_delete", { serverId, ratingKey });
    changed();
  },
  sync: () => invoke<number>("offline_sync"),
  folder: () => invoke<string>("offline_folder"),
};

export function offlinePoster(name: string) {
  return `${convertFileSrc("", "plximg")}?offline=${encodeURIComponent(name)}`;
}

/** Can be downloaded for offline use: a movie or episode, or a season or show of them. */
export function canDownload(item: Metadata) {
  return OFFLINE_SUPPORTED && ["movie", "episode", "season", "show"].includes(item.type);
}

/**
 * The offline list, kept current: every second while something downloads,
 * otherwise every 15 seconds and right after a change.
 */
export function useOffline(): OfflineItem[] | null {
  const [items, setItems] = useState<OfflineItem[] | null>(null);
  useEffect(() => {
    if (!OFFLINE_SUPPORTED) return;
    let live = true;
    let timer: number | undefined;
    const load = () => {
      window.clearTimeout(timer);
      offline
        .list()
        .then((list) => {
          if (!live) return;
          setItems(list);
          const busy = list.some((i) => i.status === "downloading" || i.status === "queued");
          timer = window.setTimeout(load, busy ? 1000 : 15000);
        })
        .catch(() => live && (timer = window.setTimeout(load, 15000)));
    };
    load();
    window.addEventListener(EVENT, load);
    return () => {
      live = false;
      window.clearTimeout(timer);
      window.removeEventListener(EVENT, load);
    };
  }, []);
  return items;
}
