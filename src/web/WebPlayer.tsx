/**
 * The browser build's player, used in place of the mpv one (see
 * vite.config.ts). It follows a PlaybackPlan (see web/playback): direct play
 * hands the file to the <video> element, direct stream and transcode play
 * Plex's HLS through hls.js (or natively in Safari). Text subtitles are drawn
 * in the browser; image ones are burned in by Plex. When a plan fails it steps
 * down the ladder (direct play, direct stream, transcode), and when Plex's
 * transcoder can't keep up it moves to a lighter plan (see lighterPlans). Keeps the desktop
 * player's skip intro/credits and Up Next rules, and a stats overlay (I).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Hls from "hls.js";
import {
  ArrowLeft,
  AudioLines,
  Captions,
  Gauge,
  Info,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";

import { SkipButton } from "@/components/SkipButton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { errorMessage, imageUrl } from "@/lib/api";
import { notifyLibraryChanged } from "@/lib/changes";
import { useNav } from "@/lib/nav";
import { loadPrefs, SUBTITLE_SIZES, usePrefs, type Prefs } from "@/lib/prefs";
import { formatTime, playback, QUALITIES, type PlaybackState } from "@/lib/player";
import { skipSegments, useSkips } from "@/lib/skips";
import { cn } from "@/lib/utils";
import {
  directPlayUrl,
  getPlaybackInfo,
  selectStreams,
  streamRefusal,
  streamUrl,
  timelineUrl,
  transcodeSessionInfo,
  type RawStream,
  type WebPlaybackInfo,
} from "@/web/plex";
import { detectCaps } from "@/web/playback/caps";
import { decide, fallback, isTextSubtitle, lighterPlans } from "@/web/playback/decide";
import { forgetStep, rememberedStep, rememberStep, STALL_SECS, STALL_SECS_HARD, tickStarved } from "@/web/playback/lighter";
import { sourceFor } from "@/web/playback/source";
import { StatsOverlay } from "@/web/playback/StatsOverlay";
import { attachSubtitles, subtitleTextAvailable } from "@/web/playback/subtitles";
import {
  ORIGINAL_TRANSCODE_MAX,
  type BrowserCaps,
  type DecideOptions,
  type LighterStep,
  type PlaybackMode,
  type PlaybackPlan,
  type QualityChoice,
  type SourceMedia,
} from "@/web/playback/types";

const REPORT_EVERY_MS = 10_000;
const UP_NEXT_SECS = 10;
const HIDE_CONTROLS_MS = 3000;

// Leaving fullscreen waits a tick after the player closes, so the next
// episode (a fresh Player mounted in the same render) can cancel it.
let exitFullscreenTimer: number | undefined;

/** The desktop list; Original is a transcode cap of 1440p (or a direct play / stream when the browser takes the file). */
const QUALITY_CHOICES: QualityChoice[] = QUALITIES.map((q) => {
  if (!q.kbps) {
    return {
      label: q.label,
      name: "Original",
      maxBitrateKbps: null,
      maxWidth: ORIGINAL_TRANSCODE_MAX.width,
      maxHeight: ORIGINAL_TRANSCODE_MAX.height,
    };
  }
  const [w, h] = (q.resolution ?? "1920x1080").split("x").map(Number);
  return { label: q.label, name: q.label, maxBitrateKbps: q.kbps, maxWidth: w, maxHeight: h };
});

const MODE_LABEL: Record<PlaybackMode, string> = {
  directPlay: "Direct play",
  directStream: "Direct stream",
  transcode: "Transcode",
};

const planKey = (p: PlaybackPlan) => `${p.mode}:${p.subtitles.kind}:${p.step ?? ""}`;

/** A plan in a few words, for the list of what was tried. */
function planLabel(p: PlaybackPlan) {
  const size = p.mode === "transcode" ? ` ${p.maxHeight}p` : "";
  const subs = p.subtitles.kind === "burn" ? ", subtitles burned in" : p.subtitles.kind === "sidecar" ? ", subtitles as text" : "";
  return `${MODE_LABEL[p.mode]}${size}${subs}`;
}

interface Attempt {
  id: number;
  plan: string;
  result: string;
}

/** What the viewer is told when the player steps down to a lighter plan. */
const STEP_NOTICE: Record<LighterStep, string> = {
  subs: "Plex can't keep up: drawing subtitles in the browser instead",
  "1080p": "Plex can't keep up: lowering to 1080p",
  original: "Plex can't keep up: playing the original picture instead",
  "720p": "Plex can't keep up: lowering to 720p",
  nosubs: "Plex can't re-encode this file: playing the original picture without subtitles",
};


function streamLabel(s: RawStream) {
  return s.extendedDisplayTitle || s.displayTitle || s.title || `Track ${s.id}`;
}

/** The first stream whose language is in an mpv-style list such as "sv,swe". */
function byLanguage(streams: RawStream[], list: string) {
  const langs = list.split(",").filter(Boolean);
  return streams.find((s) => !s.forced && s.languageCode && langs.includes(s.languageCode));
}

/** The tracks to start with: the saved language prefs win over what Plex had selected. */
function initialTracks(pi: WebPlaybackInfo, prefs: Prefs) {
  let audio = pi.audioStreams.find((s) => s.selected)?.id;
  let sub = pi.subtitleStreams.find((s) => s.selected)?.id ?? 0;
  if (prefs.audioLanguage) audio = byLanguage(pi.audioStreams, prefs.audioLanguage)?.id ?? audio;
  if (prefs.subtitleLanguage === "off") sub = 0;
  else if (prefs.subtitleLanguage) sub = byLanguage(pi.subtitleStreams, prefs.subtitleLanguage)?.id ?? sub;
  return { audio, sub };
}

interface Props {
  ratingKey: string;
  resume: boolean;
  onClose: () => void;
  onPlayNext: (ratingKey: string) => void;
  /** Played from this playlist: next and previous follow it. */
  playlist?: string;
}

export function Player({ ratingKey, resume, onClose, onPlayNext, playlist }: Props) {
  const { server } = useNav();
  const prefs = usePrefs();
  // Subtitle size and background from Settings, read by the cue style.
  useEffect(() => {
    if (!prefs) return;
    const root = document.documentElement.style;
    const scale = SUBTITLE_SIZES.find((s) => s.key === prefs.subtitleSize)?.scale ?? 1;
    root.setProperty("--plexrust-sub-scale", String(scale));
    root.setProperty("--plexrust-sub-bg", prefs.subtitleBackground ? "rgba(0, 0, 0, 0.65)" : "transparent");
  }, [prefs]);
  const [info, setInfo] = useState<WebPlaybackInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [time, setTime] = useState(0);
  const [buffering, setBuffering] = useState(true);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [quality, setQuality] = useState<QualityChoice>(QUALITY_CHOICES[0]);
  const [audioId, setAudioId] = useState<number | undefined>();
  const [subId, setSubId] = useState(0);
  const [controls, setControls] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlaybackPlan | null>(null);
  const [stats, setStats] = useState(false);
  /** What the stream is doing, and its last error, for the stats panel. */
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  /** Every plan that failed since the viewer last started playback, shown with the error. */
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const attemptId = useRef(0);

  const video = useRef<HTMLVideoElement>(null);
  const hls = useRef<Hls | null>(null);
  const session = useRef<string | null>(null);
  const caps = useRef<BrowserCaps | null>(null);
  const source = useRef<SourceMedia | null>(null);
  const planRef = useRef<PlaybackPlan | null>(null);
  const tracks = useRef<{ audio: number | undefined; sub: number }>({ audio: undefined, sub: 0 });
  const forceBurn = useRef(false);
  const subsCleanup = useRef<(() => void) | null>(null);
  /** Bumped by every start and by unmount, so older async work can tell it was superseded. */
  const startId = useRef(0);
  /** Plans that already failed since the last start the viewer asked for. */
  const failed = useRef(new Set<string>());
  /** The lighter plan in use because Plex's transcoder couldn't keep up, and the ones already tried. */
  const step = useRef<LighterStep | null>(null);
  const triedSteps = useRef(new Set<LighterStep>());
  /** Seconds the picture has been starved of data; see the watchdog below. */
  const starved = useRef(0);
  const duration = (info?.durationMs ?? 0) / 1000;
  const live = useRef({ time: 0, duration: 0, paused: false, info: null as WebPlaybackInfo | null, quality });
  live.current = { time, duration, paused, info, quality };
  const hideTimer = useRef<number | undefined>(undefined);
  const clickTimer = useRef<number | undefined>(undefined);
  const close = useRef(onClose);
  close.current = onClose;
  const finished = useRef(false);

  const segments = useMemo(
    () =>
      skipSegments(
        info?.markers ?? [],
        (info?.chapters ?? []).map((c, i) => ({ title: c.tag || `Chapter ${(c.index ?? i) + 1}`, start: c.startTimeOffset / 1000 })),
        duration,
      ),
    [info, duration],
  );
  const { skip, skipped, upNext, setUpNext } = useSkips({
    segments,
    time,
    prefs,
    ready: !!info && !buffering,
    upNextSecs: UP_NEXT_SECS,
  });

  const flash = useCallback((text: string, ms = 3000) => {
    setNotice(text);
    window.setTimeout(() => setNotice((n) => (n === text ? null : n)), ms);
  }, []);

  const finish = useCallback(() => {
    finished.current = true;
    const next = live.current.info?.next;
    if (next) onPlayNext(next.ratingKey);
    else close.current();
  }, [onPlayNext]);
  const finishRef = useRef(finish);
  finishRef.current = finish;

  const report = useCallback(
    (state: PlaybackState) => {
      const { time, duration } = live.current;
      if (!duration) return;
      const sent = playback.report(ratingKey, state, time * 1000, duration * 1000).catch(() => {});
      // Once Plex has the final position, Home and the other screens behind the player reload it.
      if (state === "stopped") sent.finally(notifyLibraryChanged);
    },
    [ratingKey],
  );

  const stopStream = useCallback(() => {
    hls.current?.destroy();
    hls.current = null;
    if (session.current) playback.stopTranscode(session.current).catch(() => {});
    session.current = null;
    subsCleanup.current?.();
    subsCleanup.current = null;
    const v = video.current;
    if (v?.hasAttribute("src")) {
      v.removeAttribute("src");
      v.load();
    }
  }, []);

  /** The lighter plans for the current source, in the order to try them. */
  const lighter = useCallback(
    (q: QualityChoice) => lighterPlans(source.current!, caps.current!, q, { sidecarFailed: forceBurn.current }),
    [],
  );

  /** Decides how to play the current source at this quality, staying on the lighter step in use. */
  const replan = useCallback(
    (q: QualityChoice) => {
      const opts: DecideOptions = forceBurn.current ? { forceBurn: true } : {};
      let p = decide(source.current!, caps.current!, q, opts);
      if (step.current) {
        const ladder = lighter(q);
        // The step may be gone (subtitles turned off, say): take the next untried one.
        p = ladder.find((l) => l.step === step.current) ?? ladder.find((l) => !triedSteps.current.has(l.step!)) ?? p;
        if (p.step && p.step !== step.current) rememberStep(source.current!, p.step);
        step.current = p.step ?? null;
        if (p.step) triedSteps.current.add(p.step);
      }
      planRef.current = p;
      setPlan(p);
      return p;
    },
    [lighter],
  );

  /** Notes that `p` failed. Returns the entry's id, so Plex's reason can be added once it answers. */
  const noteAttempt = useCallback((p: PlaybackPlan, result: string) => {
    const id = ++attemptId.current;
    setAttempts((list) => [...list, { id, plan: planLabel(p), result }]);
    return id;
  }, []);

  /** Moves to the next lighter plan, or returns false when none is left. */
  const stepDown = useCallback(
    (at: number) => {
      if (!source.current || !caps.current) return false;
      const next = lighter(live.current.quality).find((l) => !triedSteps.current.has(l.step!));
      if (!next) {
        // Nothing worked: don't start the next episode on a step that failed.
        forgetStep(source.current);
        return false;
      }
      step.current = next.step!;
      triedSteps.current.add(next.step!);
      rememberStep(source.current, next.step!);
      flash(STEP_NOTICE[next.step!], 5000);
      startRef.current(next, at, false);
      return true;
    },
    [lighter, flash],
  );

  /** Recomputes the source for the picked tracks, and whether its subtitle has to be burned in. */
  const resource = useCallback(async (pi: WebPlaybackInfo) => {
    const src = sourceFor(pi, tracks.current.audio, tracks.current.sub);
    source.current = src;
    forceBurn.current = false;
    const sub = src.subtitle;
    if (sub && isTextSubtitle(sub.codec)) {
      forceBurn.current = !(await subtitleTextAvailable(sub.streamId, sub.external));
    }
  }, []);

  const startRef = useRef<(p: PlaybackPlan, at: number, fresh?: boolean) => void>(() => {});

  /** Plays `p` from `at` seconds. `fresh` is a start the viewer asked for, not a fallback. */
  const startStream = useCallback(
    (p: PlaybackPlan, at: number, fresh = true) => {
      const v = video.current;
      const src = source.current;
      const c = caps.current;
      if (!v || !src || !c) return;
      stopStream();
      const token = ++startId.current;
      if (fresh) failed.current.clear();
      starved.current = 0;
      planRef.current = p;
      setPlan(p);
      setBuffering(true);
      setError(null);
      setStreamError(null);
      setStreamStatus(p.mode === "directPlay" ? "Loading the file" : "Asking Plex to start the stream");

      /** The plan can't play: try the next one down, or show the error. */
      const fatal = (message: string, refusedUrl?: string) => {
        if (token !== startId.current) return;
        const attempt = noteAttempt(p, message);
        // Plex answers a start it won't do with a bare HTTP 400: ask it why.
        if (refusedUrl) {
          streamRefusal(refusedUrl).then((why) => {
            if (why) setAttempts((list) => list.map((a) => (a.id === attempt ? { ...a, result: `${a.result}. Plex says: ${why}` } : a)));
          });
        }
        failed.current.add(planKey(p));
        // A lighter plan that fails outright moves on down its own ladder.
        if (p.step) {
          if (!stepDown(live.current.time || at)) setError(message);
          return;
        }
        const next = fallback(p, src, c, live.current.quality);
        if (next && !failed.current.has(planKey(next))) {
          flash(`${MODE_LABEL[p.mode]} failed, switching to ${MODE_LABEL[next.mode].toLowerCase()}`);
          startRef.current(next, live.current.time || at, false);
        } else {
          setError(message);
        }
      };

      if (p.mode === "directPlay") {
        session.current = null;
        v.src = directPlayUrl(src);
        v.addEventListener("loadedmetadata", () => (v.currentTime = at), { once: true });
        v.play().catch(() => setPaused(true));
      } else {
        const id = crypto.randomUUID();
        session.current = id;
        const url = streamUrl(ratingKey, p, { session: id, offset: at, caps: c });

        if (Hls.isSupported()) {
          const h = new Hls({ startPosition: at, maxBufferLength: 60 });
          hls.current = h;
          let recovered = false;
          h.on(Hls.Events.ERROR, (_e, data) => {
            const status = data.response?.code ? ` (HTTP ${data.response.code})` : "";
            setStreamError(`${data.details}${status}${data.fatal ? "" : " (recovered)"}`);
            if (!data.fatal) return;
            // A playlist that failed to load is never retried by startLoad(), so
            // only segment errors get the one network retry.
            const playlist =
              data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
              data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT ||
              data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR ||
              data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR ||
              data.details === Hls.ErrorDetails.LEVEL_LOAD_TIMEOUT;
            if (!recovered && !playlist && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              recovered = true;
              h.startLoad();
            } else if (!recovered && data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              recovered = true;
              h.recoverMediaError();
            } else {
              fatal(`Plex couldn't stream this${status}: ${data.details}`, playlist && data.response?.code ? url : undefined);
            }
          });
          h.on(Hls.Events.MANIFEST_LOADING, () => setStreamStatus("Asking Plex for the playlist"));
          h.on(Hls.Events.MANIFEST_PARSED, () => {
            setStreamStatus("Playlist loaded, waiting for Plex's first segment");
            v.play().catch(() => setPaused(true));
          });
          let segments = 0;
          h.on(Hls.Events.FRAG_LOADED, () => setStreamStatus(`${++segments} segment${segments === 1 ? "" : "s"} loaded`));
          h.loadSource(url);
          h.attachMedia(v);
        } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
          v.src = url;
          v.addEventListener("loadedmetadata", () => (v.currentTime = at), { once: true });
          v.play().catch(() => setPaused(true));
        } else {
          fatal("This browser can't play HLS video.");
          return;
        }
      }

      if (p.subtitles.kind === "sidecar") {
        attachSubtitles(v, p.subtitles).then(
          (cleanup) => {
            if (token === startId.current) subsCleanup.current = cleanup;
            else cleanup();
          },
          () => {
            if (token !== startId.current) return;
            forceBurn.current = true;
            // On a lighter plan, replan keeps the step (now burning) or moves to the next.
            if (!p.step) flash("Subtitles are burned in for this file");
            startRef.current(replan(live.current.quality), live.current.time || at, !p.step);
          },
        );
      }
    },
    [ratingKey, stopStream, flash, replan, stepDown, noteAttempt],
  );
  startRef.current = startStream;

  /** The video element failed: direct play, or native HLS (no hls.js to report it). */
  const onVideoError = useCallback(() => {
    const v = video.current;
    const p = planRef.current;
    const src = source.current;
    const c = caps.current;
    if (!v || !p || !src || !c || hls.current || !v.hasAttribute("src")) return;
    failed.current.add(planKey(p));
    if (p.step) {
      if (!stepDown(live.current.time)) setError(v.error?.message || "The browser couldn't play this file.");
      return;
    }
    const next = fallback(p, src, c, live.current.quality);
    if (next && !failed.current.has(planKey(next))) {
      flash(`${MODE_LABEL[p.mode]} failed, switching to ${MODE_LABEL[next.mode].toLowerCase()}`);
      startRef.current(next, live.current.time, false);
    } else {
      setError(v.error?.message || "The browser couldn't play this file.");
    }
  }, [flash, stepDown]);

  // Load the item, apply the language prefs, start streaming; tear down on close.
  useEffect(() => {
    let disposed = false;
    document.documentElement.classList.add("playing");

    (async () => {
      try {
        const [pi, prefs, detected] = await Promise.all([getPlaybackInfo(ratingKey, playlist), loadPrefs(), detectCaps()]);
        if (disposed) return;
        setInfo(pi);
        const picked = initialTracks(pi, prefs);
        const plexAudio = pi.audioStreams.find((s) => s.selected)?.id;
        const plexSub = pi.subtitleStreams.find((s) => s.selected)?.id ?? 0;
        if (picked.audio !== plexAudio || picked.sub !== plexSub) {
          await selectStreams(pi.partId, { audioStreamID: picked.audio, subtitleStreamID: picked.sub }).catch(() => {});
        }
        if (disposed) return;
        setAudioId(picked.audio);
        setSubId(picked.sub);
        tracks.current = { audio: picked.audio, sub: picked.sub };
        const q = QUALITY_CHOICES.find((q) => q.label === prefs.quality) ?? QUALITY_CHOICES[0];
        setQuality(q);
        live.current.quality = q;
        caps.current = detected;
        await resource(pi);
        if (disposed) return;
        // A file like one Plex couldn't keep up with earlier starts on the plan that worked then.
        triedSteps.current.clear();
        step.current = rememberedStep(source.current!);
        if (step.current) {
          for (const l of lighter(q)) {
            if (l.step === step.current) break;
            triedSteps.current.add(l.step!);
          }
        }
        const first = replan(q);
        if (first.step) flash("Using a lighter stream: Plex couldn't keep up with a file like this earlier. Pick a quality to try again.", 6000);
        startStream(first, resume ? pi.viewOffsetMs / 1000 : 0);
      } catch (e) {
        if (!disposed) setError(errorMessage(e));
      }
    })();

    // Closing the tab mid-episode still saves the position.
    const onHide = () => {
      const { time, duration } = live.current;
      if (duration) fetch(timelineUrl(ratingKey, "stopped", time * 1000, duration * 1000), { keepalive: true }).catch(() => {});
    };
    window.addEventListener("pagehide", onHide);

    return () => {
      disposed = true;
      startId.current++;
      window.removeEventListener("pagehide", onHide);
      if (finished.current) live.current.time = live.current.duration;
      report("stopped");
      stopStream();
      document.documentElement.classList.remove("playing");
    };
  }, [ratingKey, resume, report, startStream, stopStream, replan, resource, playlist, flash]);

  // Watchdog: a transcode Plex can't keep up with (stuck or slower than real
  // time) would otherwise buffer forever, so step down to a lighter plan.
  useEffect(() => {
    if (plan?.mode !== "transcode") return;
    let checking = false;
    let done = false;
    const t = window.setInterval(async () => {
      const v = video.current;
      if (!v || v.paused || checking || done) return;
      starved.current = tickStarved(starved.current, v.readyState < HTMLMediaElement.HAVE_FUTURE_DATA);
      if (starved.current < STALL_SECS) return;
      checking = true;
      try {
        // Plex keeping up means the wait is something else (a seek, the network): give it longer.
        const id = session.current;
        const info = id ? await transcodeSessionInfo(id).catch(() => null) : null;
        if (done || planRef.current !== plan) return;
        if ((info?.speed ?? 0) >= 1 && starved.current < STALL_SECS_HARD) return;
        starved.current = 0;
        const speed = info?.speed === undefined ? "no transcode session on Plex" : `Plex at ${info.speed.toFixed(1)}x`;
        noteAttempt(plan, `Stalled (${speed}${info?.transcodeHwFullPipeline ? ", full hardware" : info?.transcodeHwRequested ? ", hardware" : ""})`);
        if (!stepDown(live.current.time)) {
          done = true;
          flash("Plex's transcoder can't keep up with this file", 6000);
        }
      } finally {
        checking = false;
      }
    }, 1000);
    return () => {
      done = true;
      window.clearInterval(t);
    };
  }, [plan, stepDown, flash, noteAttempt]);

  // Keep Plex's Continue Watching in step while playing.
  useEffect(() => {
    if (paused) {
      report("paused");
      return;
    }
    const t = window.setInterval(() => report("playing"), REPORT_EVERY_MS);
    return () => window.clearInterval(t);
  }, [paused, report]);

  // Stay fullscreen from one episode to the next; leave it only when playback ends.
  useEffect(() => {
    window.clearTimeout(exitFullscreenTimer);
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    onChange();
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      exitFullscreenTimer = window.setTimeout(() => {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      });
    };
  }, []);

  const togglePause = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);
  const seekTo = useCallback((secs: number) => {
    const v = video.current;
    if (v) v.currentTime = Math.max(0, Math.min(secs, live.current.duration || secs));
    // A seek makes Plex start over at the new spot: that wait isn't a stall.
    starved.current = 0;
  }, []);
  const seekBy = useCallback((secs: number) => seekTo(live.current.time + secs), [seekTo]);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    // The whole page, so menus (portaled to <body>) still show in fullscreen.
    else document.documentElement.requestFullscreen().catch(() => {});
  }, []);
  const setVol = useCallback((v: number) => {
    if (!video.current) return;
    video.current.volume = Math.max(0, Math.min(1, v));
    video.current.muted = false;
  }, []);

  useEffect(() => {
    if (upNext?.countdown == null || paused) return;
    if (upNext.countdown <= 0) {
      finish();
      return;
    }
    const t = window.setTimeout(() => setUpNext({ countdown: upNext.countdown! - 1 }), 1000);
    return () => window.clearTimeout(t);
  }, [upNext, paused, finish]);

  const changeQuality = useCallback(
    (q: QualityChoice) => {
      if (!source.current || !caps.current) return;
      // Picking a quality (the current one too) leaves the lighter plan and tries the pick as is.
      if (q.label === live.current.quality.label && !step.current) return;
      step.current = null;
      triedSteps.current.clear();
      forgetStep(source.current);
      setAttempts([]);
      setQuality(q);
      live.current.quality = q;
      startStream(replan(q), live.current.time);
    },
    [startStream, replan],
  );

  /** Starts over from the normal plan, as if the lighter ones had never been tried. */
  const retry = useCallback(() => {
    if (!source.current || !caps.current) return;
    step.current = null;
    triedSteps.current.clear();
    forgetStep(source.current);
    forceBurn.current = false;
    setAttempts([]);
    startStream(replan(live.current.quality), live.current.time);
  }, [startStream, replan]);

  // Plex picks the tracks on the server, so a change restarts the stream.
  const changeTracks = useCallback(
    async (patch: { audioStreamID?: number; subtitleStreamID?: number }) => {
      const pi = live.current.info;
      if (!pi) return;
      try {
        await selectStreams(pi.partId, patch);
        if (patch.audioStreamID !== undefined) {
          setAudioId(patch.audioStreamID);
          tracks.current.audio = patch.audioStreamID;
        }
        if (patch.subtitleStreamID !== undefined) {
          setSubId(patch.subtitleStreamID);
          tracks.current.sub = patch.subtitleStreamID;
        }
        if (!caps.current) return;
        await resource(pi);
        startStream(replan(live.current.quality), live.current.time);
      } catch (e) {
        flash(`Couldn't change track: ${errorMessage(e)}`);
      }
    },
    [startStream, replan, resource, flash],
  );

  const poke = useCallback(() => {
    setControls(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!live.current.paused) setControls(false);
    }, HIDE_CONTROLS_MS);
  }, []);

  useEffect(() => {
    if (paused) setControls(true);
    else poke();
  }, [paused, poke]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== "range") return;
      poke();
      if (e.shiftKey && (e.key === "N" || e.key === "P")) {
        const to = e.key === "N" ? live.current.info?.next : live.current.info?.previous;
        if (to) onPlayNext(to.ratingKey);
        return;
      }
      const v = video.current;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePause();
          break;
        case "ArrowLeft":
        case "j":
          e.preventDefault();
          seekBy(-10);
          break;
        case "ArrowRight":
        case "l":
          e.preventDefault();
          seekBy(10);
          break;
        case "ArrowUp":
          e.preventDefault();
          if (v) setVol(v.volume + 0.05);
          break;
        case "ArrowDown":
          e.preventDefault();
          if (v) setVol(v.volume - 0.05);
          break;
        case "m":
          if (v) v.muted = !v.muted;
          break;
        case "f":
          toggleFullscreen();
          break;
        case "i":
          setStats((on) => !on);
          break;
        case "Escape":
          // In fullscreen the browser takes Escape itself to leave it.
          if (!document.fullscreenElement) onClose();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [poke, togglePause, seekBy, setVol, toggleFullscreen, onClose, onPlayNext]);

  const episodes = !!(info?.previous || info?.queue.length);

  return createPortal(
    <div
      className={cn("player fixed inset-0 z-50 bg-black select-none", !controls && "cursor-none")}
      onMouseMove={poke}
    >
      <video
        ref={video}
        className="absolute inset-0 size-full object-contain"
        playsInline
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setTime(v.currentTime);
          // Some seeks (and hls.js nudging past a gap) never send "playing";
          // playback moving on with data ahead means it isn't buffering.
          if (!v.paused && !v.seeking && v.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) setBuffering(false);
        }}
        onError={onVideoError}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onWaiting={() => setBuffering(true)}
        onSeeking={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onSeeked={(e) => !e.currentTarget.paused || setBuffering(false)}
        onCanPlay={(e) => e.currentTarget.paused && setBuffering(false)}
        onVolumeChange={(e) => {
          setVolume(e.currentTarget.volume);
          setMuted(e.currentTarget.muted);
        }}
        onEnded={() => {
          if (live.current.info?.next && prefs?.skipCredits !== "off") finishRef.current();
          else close.current();
        }}
      />

      <div
        className="absolute inset-0"
        onClick={() => {
          window.clearTimeout(clickTimer.current);
          clickTimer.current = window.setTimeout(togglePause, 220);
        }}
        onDoubleClick={() => {
          window.clearTimeout(clickTimer.current);
          toggleFullscreen();
        }}
      />

      {(buffering || !info) && !error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <Loader2 className="size-12 animate-spin text-white/80 drop-shadow" />
        </div>
      )}

      {stats && plan && source.current && (
        <StatsOverlay
          plan={plan}
          source={source.current}
          session={session.current}
          video={video.current}
          status={streamStatus}
          lastError={streamError}
          onClose={() => setStats(false)}
        />
      )}

      {notice && !error && (
        <div className="pointer-events-none absolute inset-x-0 top-24 flex justify-center px-6">
          <p className="max-w-lg rounded-xl bg-black/75 px-4 py-2.5 text-center text-sm text-white shadow-lg">{notice}</p>
        </div>
      )}

      {skip && !upNext && !error && (
        <SkipButton
          skip={skip}
          paused={paused}
          raised={controls}
          onSkip={() => {
            seekTo(skip.to);
            skipped(skip.id);
          }}
        />
      )}

      {upNext && info && !error && (
        <div
          className={cn(
            "absolute right-8 z-10 flex w-[27rem] gap-4 rounded-2xl border border-white/10 bg-black/85 p-4 text-white shadow-2xl backdrop-blur transition-[bottom] duration-300",
            controls ? "bottom-36" : "bottom-10",
          )}
        >
          {info.next?.thumb && (
            <img
              src={imageUrl(server, info.next.thumb, 160, 90)}
              alt=""
              className="aspect-video w-32 shrink-0 rounded-lg object-cover"
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="min-w-0">
              <div className="text-xs font-medium tracking-wide text-white/60 uppercase">
                {info.next ? "Up next" : "Credits"}
              </div>
              <div className="truncate font-semibold">{info.next ? info.next.title : info.title}</div>
              {info.next && <div className="truncate text-sm text-white/60">{info.next.subtitle}</div>}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={finish}>
                {info.next ? "Play now" : "Finish"}
                {upNext.countdown != null && <span className="tabular-nums opacity-70">{upNext.countdown}</span>}
              </Button>
              <Button size="sm" variant="ghost" className="text-white hover:bg-white/10" onClick={() => setUpNext(null)}>
                Keep watching
              </Button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 grid place-items-center bg-black/80">
          <div className="flex max-w-xl flex-col items-center gap-4 text-center">
            <p className="text-lg font-medium">Couldn't start playback</p>
            <p className="text-muted-foreground text-sm break-all select-text">{error}</p>
            {attempts.length > 0 && (
              <ul className="text-muted-foreground w-full space-y-1 text-left text-xs select-text">
                {attempts.map((a) => (
                  <li key={a.id}>
                    <span className="text-foreground">{a.plan}:</span> {a.result}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              {info && (
                <Button variant="secondary" onClick={retry}>
                  Try again
                </Button>
              )}
              <Button onClick={onClose}>Back</Button>
            </div>
          </div>
        </div>
      )}

      <div
        className={cn(
          "pointer-events-none absolute inset-0 transition-opacity duration-300",
          controls ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="pointer-events-auto absolute inset-x-0 top-0 flex items-center gap-4 bg-gradient-to-b from-black/80 to-transparent px-6 pt-5 pb-16">
          <Button variant="ghost" size="icon" onClick={onClose} title="Back (Esc)" className="text-white hover:bg-white/10">
            <ArrowLeft className="size-5" />
          </Button>
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold text-white">{info?.title}</div>
            {info?.subtitle && <div className="truncate text-sm text-white/70">{info.subtitle}</div>}
          </div>
        </div>

        <div className="pointer-events-auto absolute inset-x-0 bottom-0 flex flex-col gap-3 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-6 pt-20 pb-5">
          <SeekBar time={time} duration={duration} onSeek={seekTo} />
          <div className="flex items-center gap-1 text-white">
            {episodes && (
              <IconButton
                title="Previous episode (Shift+P)"
                disabled={!info?.previous}
                onClick={() => info?.previous && onPlayNext(info.previous.ratingKey)}
              >
                <SkipBack className="fill-current" />
              </IconButton>
            )}
            <IconButton title="Back 10s (←)" onClick={() => seekBy(-10)}>
              <RotateCcw />
            </IconButton>
            <IconButton title={paused ? "Play (Space)" : "Pause (Space)"} onClick={togglePause} big>
              {paused ? <Play className="fill-current" /> : <Pause className="fill-current" />}
            </IconButton>
            <IconButton title="Forward 10s (→)" onClick={() => seekBy(10)}>
              <RotateCw />
            </IconButton>
            {episodes && (
              <IconButton
                title="Next episode (Shift+N)"
                disabled={!info?.next}
                onClick={() => info?.next && onPlayNext(info.next.ratingKey)}
              >
                <SkipForward className="fill-current" />
              </IconButton>
            )}
            <span className="ml-3 text-sm text-white/80 tabular-nums">
              {formatTime(time)} / {formatTime(duration)}
            </span>

            <div className="flex-1" />

            <IconButton
              title="Mute (M)"
              onClick={() => {
                if (video.current) video.current.muted = !video.current.muted;
              }}
            >
              {muted || volume === 0 ? <VolumeX /> : <Volume2 />}
            </IconButton>
            <input
              type="range"
              min={0}
              max={100}
              value={muted ? 0 : Math.round(volume * 100)}
              onChange={(e) => setVol(Number(e.target.value) / 100)}
              className="accent-primary mr-2 w-24"
              title="Volume (↑/↓)"
            />

            <StreamMenu
              icon={<AudioLines />}
              title="Audio"
              streams={info?.audioStreams ?? []}
              selected={audioId}
              onPick={(id) => id !== undefined && changeTracks({ audioStreamID: id })}
            />
            <StreamMenu
              icon={<Captions />}
              title="Subtitles"
              streams={info?.subtitleStreams ?? []}
              selected={subId || undefined}
              allowOff
              onPick={(id) => changeTracks({ subtitleStreamID: id ?? 0 })}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" title="Quality" className="text-white hover:bg-white/10">
                  <Gauge />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top">
                <DropdownMenuLabel>
                  Quality{plan ? ` · ${MODE_LABEL[plan.mode]}` : ""}
                  {plan?.step && plan.mode === "transcode" && plan.step !== "subs" ? ` at ${plan.step}` : ""}
                </DropdownMenuLabel>
                {QUALITY_CHOICES.map((q) => (
                  <DropdownMenuCheckItem key={q.label} checked={q.label === quality.label} onSelect={() => changeQuality(q)}>
                    {q.name}
                  </DropdownMenuCheckItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <IconButton title="Stats" onClick={() => setStats((on) => !on)}>
              <Info />
            </IconButton>
            <IconButton title="Fullscreen (F)" onClick={toggleFullscreen}>
              {fullscreen ? <Minimize /> : <Maximize />}
            </IconButton>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function IconButton({
  children,
  title,
  onClick,
  big,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  big?: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn("text-white hover:bg-white/10", big && "size-11 [&_svg:not([class*='size-'])]:size-6")}
    >
      {children}
    </Button>
  );
}

function StreamMenu({
  icon,
  title,
  streams,
  selected,
  allowOff,
  onPick,
}: {
  icon: React.ReactNode;
  title: string;
  streams: RawStream[];
  selected: number | undefined;
  allowOff?: boolean;
  onPick: (id: number | undefined) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title={title}
          disabled={streams.length === 0}
          className="text-white hover:bg-white/10"
        >
          {icon}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="max-w-sm">
        <DropdownMenuLabel>{title}</DropdownMenuLabel>
        {allowOff && (
          <>
            <DropdownMenuCheckItem checked={selected === undefined} onSelect={() => onPick(undefined)}>
              Off
            </DropdownMenuCheckItem>
            <DropdownMenuSeparator />
          </>
        )}
        {streams.map((s) => (
          <DropdownMenuCheckItem key={s.id} checked={s.id === selected} onSelect={() => onPick(s.id)}>
            <span className="truncate">{streamLabel(s)}</span>
          </DropdownMenuCheckItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SeekBar({ time, duration, onSeek }: { time: number; duration: number; onSeek: (secs: number) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const at = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration;
  };

  const shown = drag ?? time;
  const pct = duration ? (shown / duration) * 100 : 0;

  return (
    <div
      ref={bar}
      className="group relative flex h-5 cursor-pointer items-center"
      onPointerMove={(e) => {
        setHover(at(e.clientX));
        if (drag !== null) setDrag(at(e.clientX));
      }}
      onPointerLeave={() => setHover(null)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(at(e.clientX));
      }}
      onPointerUp={(e) => {
        if (drag !== null) onSeek(at(e.clientX));
        setDrag(null);
      }}
    >
      <div className="relative h-1 w-full rounded-full bg-white/25 transition-[height] group-hover:h-1.5">
        <div className="bg-primary absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <div
        className="bg-primary absolute size-3.5 -translate-x-1/2 rounded-full opacity-0 shadow transition-opacity group-hover:opacity-100"
        style={{ left: `${pct}%` }}
      />
      {hover !== null && duration > 0 && (
        <div
          className="pointer-events-none absolute bottom-6 -translate-x-1/2 rounded-md bg-black/80 px-2 py-1 text-xs text-white tabular-nums"
          style={{ left: `${(hover / duration) * 100}%` }}
        >
          {formatTime(hover)}
        </div>
      )}
    </div>
  );
}
