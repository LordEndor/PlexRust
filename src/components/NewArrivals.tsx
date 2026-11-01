import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

import type { Metadata } from "@/lib/api";
import { usePrefs } from "@/lib/prefs";
import { watchlist } from "@/lib/watchlist";

const CHECK_EVERY_MS = 10 * 60_000;
const STORE_KEY = "plexrust.arrivals.since";
/** More than this at once is summed up in one notification. */
const MAX_SEPARATE = 3;

interface Arrivals {
  episodes: Metadata[];
  movies: Metadata[];
}

function readSince(server: string) {
  try {
    return Number(localStorage.getItem(`${STORE_KEY}.${server}`)) || 0;
  } catch {
    return 0;
  }
}

function writeSince(server: string, at: number) {
  try {
    localStorage.setItem(`${STORE_KEY}.${server}`, String(at));
  } catch {
    // Without storage it just checks from launch each time.
  }
}

/**
 * Windows notifications for new episodes of shows being watched and new
 * movies that are on the watchlist. Renders nothing.
 */
export function NewArrivals({ serverId }: { serverId: string }) {
  const prefs = usePrefs();
  const on = !!prefs?.newArrivalAlerts && import.meta.env.MODE !== "web";

  useEffect(() => {
    if (!on) return;
    let live = true;
    // The first run only marks the start, so nothing old is announced.
    let since = readSince(serverId) || Math.floor(Date.now() / 1000);
    writeSince(serverId, since);

    const check = async () => {
      const now = Math.floor(Date.now() / 1000);
      try {
        const { episodes, movies } = await invoke<Arrivals>("new_arrivals", { since });
        if (!live) return;
        since = now;
        writeSince(serverId, since);
        let wanted: Metadata[] = [];
        if (movies.length) {
          const list = await watchlist.list().catch(() => []);
          const guids = new Set(list.map((w) => w.item.guid));
          wanted = movies.filter((m) => m.guid && guids.has(m.guid));
        }
        const lines = [
          ...episodes.map((e) => ({
            title: e.grandparentTitle ?? "New episode",
            body: `S${e.parentIndex} · E${e.index} · ${e.title} is ready to watch`,
          })),
          ...wanted.map((m) => ({ title: m.title, body: "From your watchlist, now in your library" })),
        ];
        if (!lines.length) return;
        let granted = await isPermissionGranted();
        if (!granted) granted = (await requestPermission()) === "granted";
        if (!granted) return;
        if (lines.length > MAX_SEPARATE) {
          sendNotification({
            title: `${lines.length} new in your library`,
            body: lines.map((l) => l.title).filter((t, i, all) => all.indexOf(t) === i).join(", "),
          });
        } else {
          lines.forEach((l) => sendNotification(l));
        }
      } catch {
        // The server may be asleep; try again next time.
      }
    };

    const first = window.setTimeout(check, 30_000);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      live = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [on, serverId]);

  return null;
}
