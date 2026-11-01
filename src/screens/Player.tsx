import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  command,
  destroy,
  init,
  listenEvents,
  observeProperties,
  setProperty,
  type MpvConfig,
} from "tauri-plugin-mpv-api";
import {
  ArrowLeft,
  AudioLines,
  Check,
  Captions,
  Gauge,
  ListOrdered,
  ListVideo,
  Loader2,
  Maximize,
  Minimize,
  Minus,
  Pause,
  PictureInPicture2,
  Pin,
  PinOff,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  SlidersHorizontal,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { errorMessage, imageUrl } from "@/lib/api";
import { notifyLibraryChanged } from "@/lib/changes";
import { SkipButton } from "@/components/SkipButton";
import { SubtitleSearch } from "@/components/SubtitleSearch";
import { WindowControls } from "@/components/TitleBar";
import { skipSegments, useSkips } from "@/lib/skips";
import { useNav } from "@/lib/nav";
import { loadPrefs, SUBTITLE_SIZES, usePrefs } from "@/lib/prefs";
import {
  formatTime,
  playback,
  previewUrl,
  QUALITIES,
  type Episode,
  type ExternalSubtitle,
  type PlaybackInfo,
  type PlaybackState,
  type Quality,
  type TrackChoice,
} from "@/lib/player";
import { cn } from "@/lib/utils";

const OBSERVED = [
  "pause",
  "time-pos",
  "duration",
  "track-list",
  "chapter-list",
  "paused-for-cache",
  "volume",
  "mute",
  "eof-reached",
  "speed",
  "audio-delay",
  "sub-delay",
  "sub-scale",
] as const;

const SPEEDS = [0.5, 0.75, 1, 1.1, 1.25, 1.5, 1.75, 2];
/** Seconds one press of the sync buttons or keys moves audio or subtitles. */
const DELAY_STEP = 0.1;
const SUB_SCALE_STEP = 0.1;

function formatDelay(secs: number) {
  const ms = Math.round(secs * 1000);
  return ms === 0 ? "In sync" : `${ms > 0 ? "+" : ""}${ms} ms`;
}

const MPV_ARGS = [
  "--vo=gpu-next",
  "--hwdec=auto-safe",
  "--keep-open=yes",
  "--force-window=yes",
  // Pass HDR through to HDR displays, tone-map on SDR ones.
  "--target-colorspace-hint=yes",
  "--cache=yes",
  "--demuxer-max-bytes=512MiB",
  "--demuxer-readahead-secs=60",
  "--sub-auto=no",
  "--audio-display=no",
  "--cursor-autohide=no",
  // Show what's playing in Windows' media overlay and let media keys and
  // headset buttons reach the player. The keys are routed back through the
  // app (see MEDIA_KEYS) so next and previous follow the episode queue.
  "--media-controls=yes",
];

/** mpv key names for media keys, and what the app does with each. */
const MEDIA_KEYS = { PLAYPAUSE: "toggle", PLAY: "play", PAUSE: "pause", STOP: "stop", NEXT: "next", PREV: "previous" } as const;
type MediaAction = (typeof MEDIA_KEYS)[keyof typeof MEDIA_KEYS];
/** The same key press can arrive from both mpv and the window; act once. */
const MEDIA_DEDUPE_MS = 400;

const REPORT_EVERY_MS = 10_000;
/** Give up on a file that hasn't started after this long and try transcoding. */
const LOAD_TIMEOUT_MS = 45_000;
/** What to fall back to when the original file won't play. */
const FALLBACK = QUALITIES[1];
/** Seconds the Up Next card counts down before moving on by itself. */
const UP_NEXT_SECS = 10;
const HIDE_CONTROLS_MS = 3000;

// Leaving fullscreen waits a tick after the player closes, so the next
// episode (a fresh Player mounted in the same render) can cancel it.
let exitFullscreenTimer: number | undefined;
// Mini player and always on top carry over to the next episode the same way.
const windowModes = { mini: false, pinned: false };

function setMini(on: boolean) {
  windowModes.mini = on;
  return invoke("mini_player", { on }).catch(() => {});
}

function setPinned(on: boolean) {
  windowModes.pinned = on;
  return invoke("pin_window", { on }).catch(() => {});
}

interface Track {
  id: number;
  type: "video" | "audio" | "sub";
  title?: string;
  lang?: string;
  codec?: string;
  selected?: boolean;
  external?: boolean;
  forced?: boolean;
  "demux-channel-count"?: number;
}

function trackLabel(t: Track) {
  const parts = [t.title, t.lang?.toUpperCase(), t.codec?.toUpperCase()].filter(Boolean);
  if (t.type === "audio" && t["demux-channel-count"]) parts.push(`${t["demux-channel-count"]}ch`);
  return parts.join(" · ") || `Track ${t.id}`;
}

interface Chapter {
  title: string;
  /** Seconds. */
  start: number;
}

/** Seek-bar thumbnails for the file being played. */
interface Previews {
  partId: number;
  count: number;
  intervalMs: number;
}

/** The track matching a remembered pick: same language, ideally the same title. */
function findTrack(tracks: Track[], type: Track["type"], lang?: string | null, title?: string | null, forced?: boolean) {
  if (!lang && !title) return undefined;
  const candidates = tracks.filter(
    (t) => t.type === type && (t.lang ?? null) === (lang ?? null) && (forced === undefined || !!t.forced === forced),
  );
  return candidates.find((t) => (t.title ?? null) === (title ?? null)) ?? (lang ? candidates[0] : undefined);
}

interface Props {
  ratingKey: string;
  resume: boolean;
  onClose: () => void;
  /** Plays another episode in place of this one. */
  onPlayNext: (ratingKey: string) => void;
  /** Played from this playlist: next and previous follow it. */
  playlist?: string;
}

export function Player({ ratingKey, resume, onClose, onPlayNext, playlist }: Props) {
  const { server } = useNav();
  const prefs = usePrefs();
  const [info, setInfo] = useState<PlaybackInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffering, setBuffering] = useState(true);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [quality, setQuality] = useState<Quality>(QUALITIES[0]);
  const [controls, setControls] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Previews | null>(null);
  // Chapters mpv found in the file, used when Plex has none.
  const [fileChapters, setFileChapters] = useState<Chapter[]>([]);
  const [speed, setSpeed] = useState(1);
  const [audioDelay, setAudioDelay] = useState(0);
  const [subDelay, setSubDelay] = useState(0);
  const [subScale, setSubScale] = useState(1);
  const [searchingSubs, setSearchingSubs] = useState(false);
  const [mini, setMiniState] = useState(windowModes.mini);
  const [pinned, setPinnedState] = useState(windowModes.pinned);
  const lastMedia = useRef({ action: "", at: 0 });
  // External subtitles already handed to mpv for the file loaded now.
  const addedSubs = useRef(new Set<string>());

  // Latest values for timers and cleanup, which outlive any one render.
  const live = useRef({ time: 0, duration: 0, paused: false, info: null as PlaybackInfo | null, speed: 1 });
  live.current = { time, duration: duration || (info?.durationMs ?? 0) / 1000, paused, info, speed };
  const session = useRef(crypto.randomUUID());
  const transcoding = useRef(false);
  const hideTimer = useRef<number | undefined>(undefined);
  const clickTimer = useRef<number | undefined>(undefined);
  const close = useRef(onClose);
  close.current = onClose;
  const finished = useRef(false);
  // The audio and subtitle pick to restore, and whether it has been applied to
  // the file loaded now. Reset per load since track ids change on reload.
  const choice = useRef<TrackChoice | null>(null);
  const applied = useRef({ audio: false, sub: false });

  // Done with this item: on to the next episode, or back out of the player.
  // Either way it's reported as watched to the end.
  const total = duration || (info?.durationMs ?? 0) / 1000;
  const chapters: Chapter[] = useMemo(
    () =>
      info?.chapters.length
        ? info.chapters.map((c, i) => ({ title: c.tag || `Chapter ${(c.index ?? i) + 1}`, start: c.startTimeOffset / 1000 }))
        : fileChapters,
    [info, fileChapters],
  );
  const segments = useMemo(() => skipSegments(info?.markers ?? [], chapters, total), [info, chapters, total]);
  const { skip, skipped, upNext, setUpNext } = useSkips({
    segments,
    time,
    prefs,
    ready: !!info && !buffering,
    upNextSecs: UP_NEXT_SECS,
  });

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

  // Start mpv, load the file, tear everything down on close.
  useEffect(() => {
    let disposed = false;
    const unlisten: (() => void)[] = [];
    document.documentElement.classList.add("playing");

    (async () => {
      try {
        const pi = await playback.info(ratingKey, playlist);
        if (disposed) return;
        setInfo(pi);
        choice.current = pi.rememberedTracks ?? null;
        if (pi.hasPreviews && pi.partId) {
          const partId = pi.partId;
          playback
            .loadPreviews(partId)
            .then((p) => !disposed && p && p.count > 0 && setPreviews({ partId, ...p }))
            .catch(() => {});
        }
        const prefs = await loadPrefs();
        if (disposed) return;
        const args = [...MPV_ARGS];
        if (pi.logPath) args.push(`--log-file=${pi.logPath}`);
        if (prefs.audioLanguage) args.push(`--alang=${prefs.audioLanguage}`);
        if (prefs.subtitleLanguage === "off") args.push("--sid=no");
        else if (prefs.subtitleLanguage) args.push(`--slang=${prefs.subtitleLanguage}`);
        const size = SUBTITLE_SIZES.find((s) => s.key === prefs.subtitleSize);
        if (size && size.scale !== 1) args.push(`--sub-scale=${size.scale}`);
        if (prefs.subtitleBackground) {
          args.push("--sub-border-style=background-box", "--sub-back-color=0.0/0.0/0.0/0.65");
        }
        // Put back the audio and subtitles last picked for this show. External
        // subtitles are added after the file opens, so a subtitle pick keeps
        // being looked for as tracks appear.
        const restoreTracks = (list: Track[]) => {
          const c = choice.current;
          // The list is empty until the file has opened.
          if (!c || list.length === 0) return;
          if (!applied.current.audio) {
            const t = findTrack(list, "audio", c.audioLanguage, c.audioTitle);
            if (t) {
              applied.current.audio = true;
              if (!t.selected) setProperty<number>("aid", t.id).catch(() => {});
            }
          }
          if (!applied.current.sub) {
            if (c.subtitlesOff) {
              applied.current.sub = true;
              if (list.some((t) => t.type === "sub" && t.selected)) setProperty<string>("sid", "no").catch(() => {});
            } else {
              const t = findTrack(list, "sub", c.subtitleLanguage, c.subtitleTitle, c.subtitleForced);
              if (t) {
                applied.current.sub = true;
                if (!t.selected) setProperty<number>("sid", t.id).catch(() => {});
              }
            }
          }
        };
        const config: MpvConfig = { path: pi.mpvPath, args, observedProperties: OBSERVED, ipcTimeoutMs: 5000 };
        await init(config);
        if (disposed) return destroy();
        for (const [key, action] of Object.entries(MEDIA_KEYS)) {
          command("keybind", [key, `script-message plexrust-media ${action}`]).catch(() => {});
        }
        setProperty<string>("force-media-title", pi.subtitle ? `${pi.title} · ${pi.subtitle}` : pi.title).catch(() => {});

        unlisten.push(
          await observeProperties(OBSERVED, ({ name, data }) => {
            switch (name) {
              case "pause":
                setPaused(!!data);
                break;
              case "time-pos":
                if (typeof data === "number") setTime(data);
                break;
              case "duration":
                if (typeof data === "number") setDuration(data);
                break;
              case "track-list":
                setTracks((data as Track[]) ?? []);
                restoreTracks((data as Track[]) ?? []);
                break;
              case "chapter-list":
                setFileChapters(
                  ((data as { title?: string; time: number }[]) ?? []).map((c, i) => ({
                    title: c.title || `Chapter ${i + 1}`,
                    start: c.time,
                  })),
                );
                break;
              case "paused-for-cache":
                setBuffering(!!data);
                break;
              case "volume":
                if (typeof data === "number") setVolume(data);
                break;
              case "mute":
                setMuted(!!data);
                break;
              case "speed":
                if (typeof data === "number") setSpeed(data);
                break;
              case "audio-delay":
                if (typeof data === "number") setAudioDelay(data);
                break;
              case "sub-delay":
                if (typeof data === "number") setSubDelay(data);
                break;
              case "sub-scale":
                if (typeof data === "number") setSubScale(data);
                break;
              case "eof-reached":
                if (data) {
                  if (pi.next && prefs.skipCredits !== "off") finishRef.current();
                  else close.current();
                }
                break;
            }
          }),
        );
        const start = resume ? pi.viewOffsetMs / 1000 : 0;
        let loadTimer: number | undefined;
        const load = async (url: string, at: number) => {
          window.clearTimeout(loadTimer);
          loadTimer = window.setTimeout(() => fail("nothing played within 45 seconds"), LOAD_TIMEOUT_MS);
          await setProperty<string>("start", at > 0 ? String(at) : "none");
          await command("loadfile", [url]);
        };
        // When the original file won't play, retry once through Plex's
        // transcoder before giving up.
        const fail = async (reason: string) => {
          window.clearTimeout(loadTimer);
          if (disposed) return;
          if (transcoding.current) {
            setError(`Plex couldn't stream this either (${reason}). The mpv log is at ${pi.logPath}`);
            return;
          }
          try {
            const url = await playback.transcodeUrl(pi.ratingKey, FALLBACK.kbps!, FALLBACK.resolution!, session.current);
            if (disposed) return;
            transcoding.current = true;
            setQuality(FALLBACK);
            setNotice(`The original file wouldn't play (${reason}), so it's being transcoded to ${FALLBACK.label}.`);
            window.setTimeout(() => setNotice(null), 8000);
            await load(url, live.current.time || start);
          } catch (e) {
            if (!disposed) setError(errorMessage(e));
          }
        };
        unlisten.push(() => window.clearTimeout(loadTimer));

        unlisten.push(
          await listenEvents((ev) => {
            if (ev.event === "client-message") {
              const args = (ev as { args?: string[] }).args ?? [];
              if (args[0] === "plexrust-media") mediaRef.current(args[1] as MediaAction);
            }
            if (ev.event === "start-file") {
              applied.current = { audio: false, sub: false };
              addedSubs.current.clear();
            }
            if (ev.event === "end-file" && ev.reason === "error") {
              const detail = (ev as { file_error?: unknown }).file_error;
              fail(typeof detail === "string" ? detail : "unknown error");
            }
            // file-loaded only means the file opened; playback-restart is the
            // first frame actually playing, so the watchdog waits for that.
            if (ev.event === "playback-restart") {
              window.clearTimeout(loadTimer);
              setBuffering(false);
            }
            if (ev.event === "file-loaded") {
              if (!transcoding.current) {
                for (const s of pi.externalSubtitles) {
                  addedSubs.current.add(s.url);
                  command("sub-add", [s.url, "auto", s.title, s.language ?? ""]).catch(() => {});
                }
              }
            }
          }),
        );

        if (pi.stripDolbyVision) await setProperty<string>("vf", "format:dolbyvision=no");
        const preferred = QUALITIES.find((q) => q.label === prefs.quality && q.kbps);
        if (preferred) {
          transcoding.current = true;
          setQuality(preferred);
          await load(await playback.transcodeUrl(pi.ratingKey, preferred.kbps!, preferred.resolution!, session.current), start);
        } else {
          await load(pi.url, start);
        }
      } catch (e) {
        if (!disposed) setError(errorMessage(e));
      }
    })();

    return () => {
      disposed = true;
      if (finished.current) live.current.time = live.current.duration;
      report("stopped");
      unlisten.forEach((u) => u());
      destroy().catch(() => {});
      if (transcoding.current) playback.stopTranscode(session.current).catch(() => {});
      document.documentElement.classList.remove("playing");
    };
  }, [ratingKey, resume, report, playlist]);

  // Stay fullscreen from one episode to the next; leave it only when playback ends.
  useEffect(() => {
    window.clearTimeout(exitFullscreenTimer);
    getCurrentWindow()
      .isFullscreen()
      .then(setFullscreen)
      .catch(() => {});
    return () => {
      exitFullscreenTimer = window.setTimeout(() => {
        getCurrentWindow()
          .setFullscreen(false)
          .catch(() => {});
        if (windowModes.mini) setMini(false);
        if (windowModes.pinned) setPinned(false);
      });
    };
  }, []);

  // Discord status: what's playing and the time left, refreshed on pause,
  // seeks and every half minute. Cleared when playback ends.
  const discordOn = !!prefs?.discordStatus && !!prefs.discordAppId;
  const discordTick = Math.floor(time / 30);
  useEffect(() => {
    if (!discordOn || !info || !prefs) return;
    // Episodes read "Show" over "S1 · E2 · Title"; movies "Title" over the year.
    const [show, ...episode] = info.subtitle?.includes(" · ") ? info.subtitle.split(" · ") : [];
    const line = show ? `${episode.join(" · ")} · ${info.title}` : (info.subtitle ?? "");
    invoke("discord_presence", {
      appId: prefs.discordAppId,
      details: show ?? info.title,
      state: paused ? `Paused · ${line}` : line,
      positionMs: paused ? null : Math.round(live.current.time * 1000),
      durationMs: paused ? null : Math.round(live.current.duration * 1000),
    }).catch(() => {});
  }, [discordOn, info, paused, discordTick, prefs]);
  useEffect(() => {
    if (!discordOn) return;
    return () => {
      invoke("discord_clear").catch(() => {});
    };
  }, [discordOn]);

  // Keep Plex's Continue Watching in step while playing.
  useEffect(() => {
    if (paused) {
      report("paused");
      return;
    }
    const t = window.setInterval(() => report("playing"), REPORT_EVERY_MS);
    return () => window.clearInterval(t);
  }, [paused, report]);

  const togglePause = useCallback(() => command("cycle", ["pause"]).catch(() => {}), []);
  const seekBy = useCallback((secs: number) => command("seek", [secs, "relative", "exact"]).catch(() => {}), []);
  const seekTo = useCallback((secs: number) => command("seek", [secs, "absolute", "exact"]).catch(() => {}), []);

  // Up Next counts down while playing, then moves on.
  useEffect(() => {
    if (upNext?.countdown == null || paused) return;
    if (upNext.countdown <= 0) {
      finish();
      return;
    }
    const t = window.setTimeout(() => setUpNext({ countdown: upNext.countdown! - 1 }), 1000);
    return () => window.clearTimeout(t);
  }, [upNext, paused, finish]);

  const toggleMini = useCallback(async () => {
    const next = !windowModes.mini;
    if (next) setFullscreen(false);
    setMiniState(next);
    await setMini(next);
    // Back from the mini player, keep the window on top if it was pinned.
    if (!next && windowModes.pinned) setPinned(true);
  }, []);

  const togglePinned = useCallback(() => {
    const next = !windowModes.pinned;
    setPinnedState(next);
    // The mini player is always on top anyway; this is for the normal window.
    if (!windowModes.mini) setPinned(next);
    else windowModes.pinned = next;
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (windowModes.mini) {
      setMiniState(false);
      await setMini(false);
    }
    const win = getCurrentWindow();
    const next = !(await win.isFullscreen());
    await win.setFullscreen(next);
    setFullscreen(next);
  }, []);

  const changeQuality = useCallback(
    async (q: Quality) => {
      if (!info || q.label === quality.label) return;
      const at = live.current.time;
      const wasTranscoding = transcoding.current;
      const url = q.kbps
        ? await playback.transcodeUrl(info.ratingKey, q.kbps, q.resolution!, session.current)
        : info.url;
      transcoding.current = !!q.kbps;
      setQuality(q);
      setBuffering(true);
      await setProperty<string>("start", String(at));
      await command("loadfile", [url]);
      if (wasTranscoding && !q.kbps) playback.stopTranscode(session.current).catch(() => {});
    },
    [info, quality.label],
  );

  // Show controls on activity, hide them again while playing.
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

  // Media keys, from the keyboard or Windows' media overlay.
  const onMedia = (action: MediaAction) => {
    const now = Date.now();
    if (lastMedia.current.action === action && now - lastMedia.current.at < MEDIA_DEDUPE_MS) return;
    lastMedia.current = { action, at: now };
    poke();
    const { info } = live.current;
    switch (action) {
      case "toggle":
        togglePause();
        break;
      case "play":
        setProperty<boolean>("pause", false).catch(() => {});
        break;
      case "pause":
        setProperty<boolean>("pause", true).catch(() => {});
        break;
      case "stop":
        onClose();
        break;
      case "next":
        if (info?.next) onPlayNext(info.next.ratingKey);
        break;
      case "previous":
        // Like other players: back to the start first, then the previous episode.
        if (live.current.time > 5 || !info?.previous) seekTo(0);
        else onPlayNext(info.previous.ratingKey);
        break;
    }
  };
  const mediaRef = useRef(onMedia);
  mediaRef.current = onMedia;

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      poke();
      const media: Record<string, MediaAction> = {
        MediaPlayPause: "toggle",
        MediaStop: "stop",
        MediaTrackNext: "next",
        MediaTrackPrevious: "previous",
      };
      if (media[e.key]) {
        e.preventDefault();
        mediaRef.current(media[e.key]);
        return;
      }
      // Keys inside an open menu navigate or close the menu, not the player.
      if (document.querySelector('[role="menu"], [role="dialog"]')) return;
      if (e.shiftKey && (e.key === "N" || e.key === "P")) {
        const to = e.key === "N" ? live.current.info?.next : live.current.info?.previous;
        if (to) onPlayNext(to.ratingKey);
        return;
      }
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePause();
          break;
        case "ArrowLeft":
        case "j":
          seekBy(-10);
          break;
        case "ArrowRight":
        case "l":
          seekBy(10);
          break;
        case "ArrowUp":
          command("add", ["volume", 5]).catch(() => {});
          break;
        case "ArrowDown":
          command("add", ["volume", -5]).catch(() => {});
          break;
        case "m":
          command("cycle", ["mute"]).catch(() => {});
          break;
        case "s":
          command("cycle", ["sub"]).catch(() => {});
          break;
        case "f":
          toggleFullscreen();
          break;
        case "[":
        case "]": {
          const i = SPEEDS.findIndex((s) => s >= live.current.speed - 0.001);
          const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, (i < 0 ? SPEEDS.length : i) + (e.key === "]" ? 1 : -1)))];
          setProperty<number>("speed", next).catch(() => {});
          break;
        }
        case "Backspace":
          setProperty<number>("speed", 1).catch(() => {});
          break;
        case "z":
        case "x":
          command("add", ["sub-delay", e.key === "x" ? DELAY_STEP : -DELAY_STEP]).catch(() => {});
          break;
        case "Z":
        case "X":
          command("add", ["audio-delay", e.key === "X" ? DELAY_STEP : -DELAY_STEP]).catch(() => {});
          break;
        case "p":
          toggleMini();
          break;
        case "t":
          togglePinned();
          break;
        case "Escape":
          if (windowModes.mini) toggleMini();
          else if (await getCurrentWindow().isFullscreen()) toggleFullscreen();
          else onClose();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [poke, togglePause, seekBy, toggleFullscreen, toggleMini, togglePinned, onClose, onPlayNext]);

  const audio = tracks.filter((t) => t.type === "audio");
  const subs = tracks.filter((t) => t.type === "sub");
  // Episodes get previous and next buttons, even at either end of the show.
  const episodes = !!(info?.previous || info?.queue.length);

  // A pick from the menus becomes the remembered one for this show.
  const pickTrack = (type: "audio" | "sub", id: number | undefined) => {
    applied.current[type] = true;
    if (info) {
      const t = tracks.find((t) => t.id === id && t.type === type);
      const current = tracks.filter((t) => t.selected);
      const sel = (kind: Track["type"]) => (kind === type ? t : current.find((c) => c.type === kind));
      const a = sel("audio");
      const sub = sel("sub");
      const next: TrackChoice = {
        audioLanguage: a?.lang ?? null,
        audioTitle: a?.title ?? null,
        subtitlesOff: !sub,
        subtitleLanguage: sub?.lang ?? null,
        subtitleTitle: sub?.title ?? null,
        subtitleForced: !!sub?.forced,
      };
      choice.current = next;
      playback.rememberTracks(info.trackKey, next).catch(() => {});
    }
    return type === "audio"
      ? setProperty<number | string>("aid", id ?? "auto")
      : setProperty<number | string>("sid", id ?? "no");
  };

  return createPortal(
    <div
      className={cn("player fixed inset-0 z-50 select-none", !controls && "cursor-none")}
      onMouseMove={poke}
    >
      {/* Click the video to pause, double-click for fullscreen. The click
          waits a moment so a double-click doesn't also pause. */}
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
            mini ? "absolute right-2 left-2 z-10 flex gap-3 rounded-xl" : "absolute right-8 z-10 flex w-[27rem] gap-4 rounded-2xl",
            " border border-white/10 bg-black/85 p-4 text-white shadow-2xl backdrop-blur transition-[bottom] duration-300",
            mini ? (controls ? "bottom-24" : "bottom-2") : controls ? "bottom-36" : "bottom-10",
          )}
        >
          {info.next?.thumb && !mini && (
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

      {searchingSubs && info && (
        <SubtitleSearch
          ratingKey={info.ratingKey}
          title={info.subtitle ? `${info.title} · ${info.subtitle}` : info.title}
          onClose={() => setSearchingSubs(false)}
          onDownloaded={(all: ExternalSubtitle[]) => {
            // Load the new file and switch to it.
            for (const s of all) {
              if (addedSubs.current.has(s.url)) continue;
              addedSubs.current.add(s.url);
              command("sub-add", [s.url, "select", s.title, s.language ?? ""]).catch(() => {});
            }
            setSearchingSubs(false);
          }}
        />
      )}

      {error && (
        <div className="absolute inset-0 grid place-items-center bg-black/80">
          <div className="flex max-w-md flex-col items-center gap-4 text-center">
            <p className="text-lg font-medium">Couldn't start playback</p>
            <p className="text-muted-foreground text-sm break-all select-text">{error}</p>
            <Button onClick={onClose}>Back</Button>
          </div>
        </div>
      )}

      <div
        className={cn(
          "pointer-events-none absolute inset-0 transition-opacity duration-300",
          controls ? "opacity-100" : "opacity-0",
        )}
      >
        <div
          data-tauri-drag-region
          className={cn(
            "pointer-events-auto absolute inset-x-0 top-0 flex items-center bg-gradient-to-b from-black/80 to-transparent",
            mini ? "gap-2 px-2 pt-2 pb-8" : "gap-4 px-6 pt-5 pb-16",
          )}
        >
          {!fullscreen && !mini && <WindowControls className="absolute top-0 right-0 [&_button]:text-white/80" />}
          <Button variant="ghost" size="icon" onClick={onClose} title="Back (Esc)" className="text-white hover:bg-white/10">
            <ArrowLeft className="size-5" />
          </Button>
          <div className="min-w-0">
            <div className={cn("truncate font-semibold text-white", mini ? "text-sm" : "text-lg")}>{info?.title}</div>
            {info?.subtitle && !mini && <div className="truncate text-sm text-white/70">{info.subtitle}</div>}
          </div>
        </div>

        <div
          className={cn(
            "pointer-events-auto absolute inset-x-0 bottom-0 flex flex-col bg-gradient-to-t from-black/85 via-black/50 to-transparent",
            mini ? "gap-1 px-2 pt-10 pb-1" : "gap-3 px-6 pt-20 pb-5",
          )}
        >
          <SeekBar time={time} duration={total} onSeek={seekTo} chapters={chapters} previews={previews} />
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
            {!mini && (
              <IconButton title="Back 10s (←)" onClick={() => seekBy(-10)}>
                <RotateCcw />
              </IconButton>
            )}
            <IconButton title={paused ? "Play (Space)" : "Pause (Space)"} onClick={togglePause} big>
              {paused ? <Play className="fill-current" /> : <Pause className="fill-current" />}
            </IconButton>
            {!mini && (
              <IconButton title="Forward 10s (→)" onClick={() => seekBy(10)}>
                <RotateCw />
              </IconButton>
            )}
            {episodes && (
              <IconButton
                title="Next episode (Shift+N)"
                disabled={!info?.next}
                onClick={() => info?.next && onPlayNext(info.next.ratingKey)}
              >
                <SkipForward className="fill-current" />
              </IconButton>
            )}
            <span className={cn("text-white/80 tabular-nums", mini ? "ml-1 text-xs" : "ml-3 text-sm")}>
              {formatTime(time)} / {formatTime(total)}
            </span>

            <div className="flex-1" />

            <IconButton title="Mute (M)" onClick={() => command("cycle", ["mute"]).catch(() => {})}>
              {muted || volume === 0 ? <VolumeX /> : <Volume2 />}
            </IconButton>
            {!mini && (
              <>
              <input
                type="range"
                min={0}
                max={100}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  setProperty<number>("volume", Number(e.target.value)).catch(() => {});
                  if (muted) setProperty<boolean>("mute", false).catch(() => {});
                }}
                className="accent-primary mr-2 w-24"
                title="Volume (↑/↓)"
              />

              {info && info.queue.length > 0 && (
                <QueueMenu queue={info.queue} onPlay={(ep) => onPlayNext(ep.ratingKey)} />
              )}
              {chapters.length > 1 && <ChapterMenu chapters={chapters} time={time} previews={previews} onSeek={seekTo} />}
              <TrackMenu icon={<AudioLines />} title="Audio" tracks={audio} onPick={(id) => pickTrack("audio", id)} />
              <TrackMenu
                icon={<Captions />}
                title="Subtitles"
                tracks={subs}
                allowOff
                onPick={(id) => pickTrack("sub", id)}
                extra={
                  info && (
                    <DropdownMenuItem onSelect={() => setSearchingSubs(true)}>
                      <Search /> Search online…
                    </DropdownMenuItem>
                  )
                }
              />
              <SyncMenu speed={speed} audioDelay={audioDelay} subDelay={subDelay} subScale={subScale} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" title="Quality" className="text-white hover:bg-white/10">
                    <Gauge />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top">
                  <DropdownMenuLabel>Quality</DropdownMenuLabel>
                  {QUALITIES.map((q) => (
                    <DropdownMenuCheckItem key={q.label} checked={q.label === quality.label} onSelect={() => changeQuality(q)}>
                      {q.label}
                    </DropdownMenuCheckItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <IconButton
                title={pinned ? "Stop keeping on top (T)" : "Keep on top of other windows (T)"}
                onClick={togglePinned}
                className={cn(pinned && "text-primary")}
              >
                {pinned ? <PinOff /> : <Pin />}
              </IconButton>
              </>
            )}
            <IconButton
              title={mini ? "Back to the full window (P)" : "Mini player (P)"}
              onClick={toggleMini}
              className={cn(mini && "text-primary")}
            >
              <PictureInPicture2 />
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
  className,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  big?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn("text-white hover:bg-white/10", big && "size-11 [&_svg:not([class*='size-'])]:size-6", className)}
    >
      {children}
    </Button>
  );
}

function TrackMenu({
  icon,
  title,
  tracks,
  allowOff,
  onPick,
  extra,
}: {
  icon: React.ReactNode;
  title: string;
  tracks: Track[];
  allowOff?: boolean;
  onPick: (id: number | undefined) => Promise<void>;
  /** More actions under the tracks, such as searching for subtitles. */
  extra?: React.ReactNode;
}) {
  const none = !tracks.some((t) => t.selected);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title={title}
          disabled={tracks.length === 0 && !extra}
          className="text-white hover:bg-white/10"
        >
          {icon}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="max-w-sm">
        <DropdownMenuLabel>{title}</DropdownMenuLabel>
        {allowOff && (
          <>
            <DropdownMenuCheckItem checked={none} onSelect={() => onPick(undefined).catch(() => {})}>
              Off
            </DropdownMenuCheckItem>
            <DropdownMenuSeparator />
          </>
        )}
        {tracks.map((t) => (
          <DropdownMenuCheckItem key={t.id} checked={!!t.selected} onSelect={() => onPick(t.id).catch(() => {})}>
            <span className="truncate">{trackLabel(t)}</span>
          </DropdownMenuCheckItem>
        ))}
        {extra && (
          <>
            <DropdownMenuSeparator />
            {extra}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Playback speed, audio and subtitle sync, and subtitle size, for this file only. */
function SyncMenu({
  speed,
  audioDelay,
  subDelay,
  subScale,
}: {
  speed: number;
  audioDelay: number;
  subDelay: number;
  subScale: number;
}) {
  const changed = speed !== 1 || audioDelay !== 0 || subDelay !== 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title="Speed and sync"
          className={cn("relative text-white hover:bg-white/10", changed && "text-primary")}
        >
          <SlidersHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-72">
        <DropdownMenuLabel>Speed ([ and ])</DropdownMenuLabel>
        <div className="flex flex-wrap gap-1 px-2 pb-2">
          {SPEEDS.map((s) => (
            <button
              key={s}
              className={cn(
                "hover:bg-accent rounded-md px-2 py-1 text-xs tabular-nums",
                Math.abs(s - speed) < 0.001 && "bg-primary text-primary-foreground hover:bg-primary",
              )}
              onClick={() => setProperty<number>("speed", s).catch(() => {})}
            >
              {s}×
            </button>
          ))}
        </div>
        <DropdownMenuSeparator />
        <Stepper
          label="Audio sync"
          keys="Shift+Z / Shift+X"
          value={formatDelay(audioDelay)}
          onStep={(d) => command("add", ["audio-delay", d * DELAY_STEP]).catch(() => {})}
          onReset={audioDelay !== 0 ? () => setProperty<number>("audio-delay", 0).catch(() => {}) : undefined}
        />
        <Stepper
          label="Subtitle sync"
          keys="Z / X"
          value={formatDelay(subDelay)}
          onStep={(d) => command("add", ["sub-delay", d * DELAY_STEP]).catch(() => {})}
          onReset={subDelay !== 0 ? () => setProperty<number>("sub-delay", 0).catch(() => {}) : undefined}
        />
        <Stepper
          label="Subtitle size"
          value={`${Math.round(subScale * 100)}%`}
          onStep={(d) => setProperty<number>("sub-scale", Math.max(0.4, Math.min(3, subScale + d * SUB_SCALE_STEP))).catch(() => {})}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Stepper({
  label,
  keys,
  value,
  onStep,
  onReset,
}: {
  label: string;
  keys?: string;
  value: string;
  onStep: (direction: 1 | -1) => void;
  onReset?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm">{label}</div>
        <div className="text-muted-foreground text-xs">
          {value}
          {onReset && (
            <button className="text-primary ml-2 hover:underline" onClick={onReset}>
              Reset
            </button>
          )}
        </div>
        {keys && <div className="text-muted-foreground/70 text-[11px]">{keys}</div>}
      </div>
      <Button variant="outline" size="icon" className="size-7" aria-label={`${label} down`} onClick={() => onStep(-1)}>
        <Minus />
      </Button>
      <Button variant="outline" size="icon" className="size-7" aria-label={`${label} up`} onClick={() => onStep(1)}>
        <Plus />
      </Button>
    </div>
  );
}

/** Index of the chapter playing at `secs`, or -1 before the first. */
function chapterAt(chapters: Chapter[], secs: number) {
  let i = -1;
  chapters.forEach((c, j) => {
    if (c.start <= secs + 0.5) i = j;
  });
  return i;
}

function previewFrame(previews: Previews, secs: number) {
  return previewUrl(previews.partId, Math.min(previews.count - 1, Math.floor((secs * 1000) / previews.intervalMs)));
}

function QueueMenu({ queue, onPlay }: { queue: Episode[]; onPlay: (ep: Episode) => void }) {
  const { server } = useNav();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" title="Up next" className="text-white hover:bg-white/10">
          <ListOrdered />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="max-h-[60vh] w-96 overflow-y-auto">
        <DropdownMenuLabel>Up next</DropdownMenuLabel>
        {queue.map((ep) => (
          <DropdownMenuCheckItem key={ep.ratingKey} onSelect={() => onPlay(ep)} className="gap-3 pl-2">
            <img
              src={imageUrl(server, ep.thumb, 112, 63)}
              alt=""
              className="bg-muted aspect-video w-28 shrink-0 rounded object-cover"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{ep.title}</div>
              <div className="text-muted-foreground truncate text-xs">
                {ep.subtitle}
                {ep.durationMs ? ` · ${Math.round(ep.durationMs / 60000)} min` : ""}
              </div>
            </div>
            {ep.watched && <Check className="text-muted-foreground size-4 shrink-0" aria-label="Watched" />}
          </DropdownMenuCheckItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ChapterMenu({
  chapters,
  time,
  previews,
  onSeek,
}: {
  chapters: Chapter[];
  time: number;
  previews: Previews | null;
  onSeek: (secs: number) => void;
}) {
  const current = chapterAt(chapters, time);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" title="Chapters" className="text-white hover:bg-white/10">
          <ListVideo />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="max-h-[60vh] w-80 overflow-y-auto">
        <DropdownMenuLabel>Chapters</DropdownMenuLabel>
        {chapters.map((c, i) => (
          <DropdownMenuCheckItem key={i} checked={i === current} onSelect={() => onSeek(c.start)} className="gap-3">
            {previews && (
              <img src={previewFrame(previews, c.start)} alt="" className="aspect-video w-20 shrink-0 rounded object-cover" />
            )}
            <span className="min-w-0 flex-1 truncate">{c.title}</span>
            <span className="text-muted-foreground text-xs tabular-nums">{formatTime(c.start)}</span>
          </DropdownMenuCheckItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SeekBar({
  time,
  duration,
  onSeek,
  chapters,
  previews,
}: {
  time: number;
  duration: number;
  onSeek: (secs: number) => void;
  chapters: Chapter[];
  previews: Previews | null;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const at = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration;
  };

  const shown = drag ?? time;
  const pct = duration ? (shown / duration) * 100 : 0;
  const ticks = duration ? chapters.filter((c) => c.start > 1 && c.start < duration - 1) : [];
  // While dragging the preview follows the drag, otherwise the pointer.
  const peek = drag ?? hover;
  const peekChapter = peek !== null && chapters.length > 1 ? chapters[chapterAt(chapters, peek)] : undefined;
  // Keep the bubble inside the window at either end of the bar.
  const edge = previews ? "6rem" : "2rem";

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
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/25 transition-[height] group-hover:h-1.5">
        <div className="bg-primary absolute inset-y-0 left-0" style={{ width: `${pct}%` }} />
        {ticks.map((c) => (
          <div
            key={c.start}
            className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-black/70"
            style={{ left: `${(c.start / duration) * 100}%` }}
          />
        ))}
      </div>
      <div
        className="bg-primary absolute size-3.5 -translate-x-1/2 rounded-full opacity-0 shadow transition-opacity group-hover:opacity-100"
        style={{ left: `${pct}%` }}
      />
      {peek !== null && duration > 0 && (
        <div
          className="pointer-events-none absolute bottom-6 flex -translate-x-1/2 flex-col items-center gap-1.5"
          style={{ left: `clamp(${edge}, ${(peek / duration) * 100}%, calc(100% - ${edge}))` }}
        >
          {previews && (
            <img
              src={previewFrame(previews, peek)}
              alt=""
              className="aspect-video w-48 rounded-lg border border-white/20 bg-black object-cover shadow-xl"
            />
          )}
          <div className="max-w-48 rounded-md bg-black/80 px-2 py-1 text-center text-xs text-white">
            {peekChapter && <div className="truncate text-white/70">{peekChapter.title}</div>}
            <div className="tabular-nums">{formatTime(peek)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
