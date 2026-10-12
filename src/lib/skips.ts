import { useEffect, useRef, useState } from "react";

import type { Marker } from "@/lib/player";
import type { Prefs, SkipMode } from "@/lib/prefs";

export type SkipKind = "intro" | "recap" | "credits" | "outro";

/** A stretch of the file the player can skip, in seconds. */
export interface SkipSegment {
  kind: SkipKind;
  start: number;
  end: number;
  /** Runs to the end of the file, so skipping it means moving on (Up Next). */
  ending: boolean;
}

/** Seconds the skip button fills up before an automatic skip. */
export const AUTO_SKIP_SECS = 5;

const LABELS: Record<SkipKind, string> = {
  intro: "Skip intro",
  recap: "Skip recap",
  credits: "Skip credits",
  outro: "Skip outro",
};

// Plex only detects intros and credits. Recaps and outros come from chapter
// names, which anime and many rips carry ("Recap", "Previously on", "ED").
const CHAPTER_KINDS: [SkipKind, RegExp][] = [
  ["recap", /\b(recap|previously)\b/i],
  ["outro", /^(ed|ending|outro)\b|\boutro\b|ending (theme|song|credits)/i],
  ["intro", /^(op|opening|intro)\b|opening (theme|song|credits)/i],
];

export function skipSegments(
  markers: Marker[],
  chapters: { title: string; start: number }[],
  duration: number,
): SkipSegment[] {
  const nearEnd = (end: number) => duration > 0 && end >= duration - 5;
  const segments: SkipSegment[] = [];
  for (const m of markers) {
    if (m.type !== "intro" && m.type !== "credits") continue;
    const end = m.endTimeOffset / 1000;
    segments.push({ kind: m.type, start: m.startTimeOffset / 1000, end, ending: m.type === "credits" && (!!m.final || nearEnd(end)) });
  }
  const sorted = [...chapters].sort((a, b) => a.start - b.start);
  sorted.forEach((c, i) => {
    const kind = CHAPTER_KINDS.find(([, re]) => re.test(c.title.trim()))?.[0];
    if (!kind) return;
    const end = sorted[i + 1]?.start ?? duration;
    if (!(end > c.start)) return;
    // Plex's own marker wins where both cover the same stretch.
    if (segments.some((s) => s.start < end && c.start < s.end)) return;
    segments.push({ kind, start: c.start, end, ending: kind === "outro" && nearEnd(end) });
  });
  return segments.sort((a, b) => a.start - b.start);
}

export function skipMode(kind: SkipKind, prefs: Prefs): SkipMode {
  if (kind === "intro") return prefs.skipIntro;
  if (kind === "recap") return prefs.skipRecap;
  if (kind === "outro") return prefs.skipOutro;
  return prefs.skipCredits;
}

export interface SkipOffer {
  /** Changes per segment, so the button restarts its fill. */
  id: number;
  label: string;
  to: number;
  /** Seconds the button fills before skipping on its own; null waits for a click. */
  autoSecs: number | null;
}

/**
 * The skip rules both players share: inside a recap, intro, credits or outro,
 * offer a button (filling up first when set to skip automatically), and bring
 * up Up Next once the ending credits or outro start.
 */
export function useSkips({
  segments,
  time,
  prefs,
  ready,
  upNextSecs,
}: {
  segments: SkipSegment[];
  time: number;
  prefs: Prefs | null;
  /** False while loading, seeking or buffering, when `time` can be stale. */
  ready: boolean;
  upNextSecs: number;
}) {
  const [skip, setSkip] = useState<SkipOffer | null>(null);
  // Shown once the ending starts; countdown is null when waiting for a click.
  const [upNext, setUpNext] = useState<{ countdown: number | null } | null>(null);
  // Segments already offered automatically or brought up Up Next, by index.
  const handled = useRef(new Set<number>());
  // Each segment's auto countdown runs once; rewinding into it shows a plain button.
  const autoFor = useRef(new Map<number, number>());
  // The segment just skipped, hidden until playback has left it.
  const dismissed = useRef<number | null>(null);

  useEffect(() => {
    if (!prefs || !ready) return;
    const i = segments.findIndex((s) => time >= s.start && time < s.end - 1);
    if (i !== dismissed.current) dismissed.current = null;
    const s = segments[i];
    const mode = s ? skipMode(s.kind, prefs) : "off";

    if (s?.ending && mode !== "off") {
      setSkip(null);
      if (!handled.current.has(i)) {
        handled.current.add(i);
        setUpNext({ countdown: mode === "auto" ? upNextSecs : null });
      }
      return;
    }
    setUpNext(null);

    if (!s || mode === "off" || i === dismissed.current) {
      setSkip(null);
      return;
    }
    if (mode === "auto" && !handled.current.has(i)) {
      handled.current.add(i);
      // Never fill past the segment itself.
      autoFor.current.set(i, Math.max(1, Math.min(AUTO_SKIP_SECS, s.end - time - 1)));
    }
    const autoSecs = autoFor.current.get(i) ?? null;
    setSkip((cur) =>
      cur?.id === i && cur.autoSecs === autoSecs ? cur : { id: i, label: LABELS[s.kind], to: s.end, autoSecs },
    );
  }, [segments, time, prefs, ready, upNextSecs]);

  /** Clicked, or the fill ran out: the countdown is spent either way. */
  const skipped = (id: number) => {
    autoFor.current.delete(id);
    dismissed.current = id;
    setSkip(null);
  };

  return { skip, skipped, upNext, setUpNext };
}
