import type { Metadata } from "@/lib/api";

export function formatDuration(ms?: number | null) {
  if (!ms) return null;
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function progress(m: Metadata) {
  if (!m.viewOffset || !m.duration) return 0;
  return Math.min(1, m.viewOffset / m.duration);
}

export function isWatched(m: Metadata) {
  if (m.type === "show" || m.type === "season") {
    return !!m.leafCount && m.viewedLeafCount === m.leafCount;
  }
  return (m.viewCount ?? 0) > 0 && !m.viewOffset;
}

export function unwatchedCount(m: Metadata) {
  if (m.type !== "show" && m.type !== "season") return 0;
  return Math.max(0, (m.leafCount ?? 0) - (m.viewedLeafCount ?? 0));
}

/** "S1 · E3" for episodes. */
export function episodeLabel(m: Metadata) {
  if (m.type !== "episode") return null;
  return `S${m.parentIndex ?? "?"} · E${m.index ?? "?"}`;
}

/** Second line under a poster. */
export function subtitle(m: Metadata) {
  switch (m.type) {
    case "episode":
      return `${m.grandparentTitle ?? ""} · ${episodeLabel(m)}`;
    case "season":
      return m.parentTitle ?? "";
    case "collection":
      return m.childCount ? `${m.childCount} item${m.childCount === 1 ? "" : "s"}` : "Collection";
    case "show":
      return m.childCount ? `${m.childCount} season${m.childCount === 1 ? "" : "s"}` : (m.year?.toString() ?? "");
    default:
      return m.year?.toString() ?? "";
  }
}

export function resolutionLabel(m: Metadata) {
  const r = m.Media[0]?.videoResolution?.toLowerCase();
  if (!r) return null;
  if (r === "4k") return "4K";
  if (/^\d+$/.test(r)) return `${r}p`;
  return r.toUpperCase();
}
