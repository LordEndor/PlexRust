/**
 * The browser build's player, used in place of the mpv one (see
 * vite.config.ts). It plays Plex's HLS transcode in a <video> element through
 * hls.js and keeps the desktop player's skip intro/credits and Up Next rules.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Hls from "hls.js";
import {
  ArrowLeft,
  AudioLines,
  ChevronsRight,
  Captions,
  Gauge,
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
import { useNav } from "@/lib/nav";
import { loadPrefs, usePrefs, type Prefs } from "@/lib/prefs";
import { formatTime, playback, QUALITIES, type PlaybackState } from "@/lib/player";
import { cn } from "@/lib/utils";
import { getPlaybackInfo, selectStreams, timelineUrl, transcodeUrl, type RawStream, type WebPlaybackInfo } from "@/web/plex";

const REPORT_EVERY_MS = 10_000;
const UP_NEXT_SECS = 10;
const HIDE_CONTROLS_MS = 3000;

interface WebQuality {
  /** Matches the label saved in prefs. */
  label: string;
  name: string;
  kbps: number;
  resolution: string;
}

/**
 * The desktop list, except Original: a browser can't play most originals, so
 * it means "as good as the browser takes", which leaves H.264 files untouched.
 */
const WEB_QUALITIES: WebQuality[] = QUALITIES.map((q) =>
  q.kbps
    ? { label: q.label, name: q.label, kbps: q.kbps, resolution: q.resolution! }
    : { label: q.label, name: "Best · up to 1080p", kbps: 200_000, resolution: "1920x1080" },
);

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
  const [info, setInfo] = useState<WebPlaybackInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [time, setTime] = useState(0);
  const [buffering, setBuffering] = useState(true);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [quality, setQuality] = useState<WebQuality>(WEB_QUALITIES[0]);
  const [audioId, setAudioId] = useState<number | undefined>();
  const [subId, setSubId] = useState(0);
  const [controls, setControls] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [skip, setSkip] = useState<{ label: string; to: number } | null>(null);
  const [upNext, setUpNext] = useState<{ countdown: number | null } | null>(null);

  const video = useRef<HTMLVideoElement>(null);
  const hls = useRef<Hls | null>(null);
  const session = useRef<string | null>(null);
  const duration = (info?.durationMs ?? 0) / 1000;
  const live = useRef({ time: 0, duration: 0, paused: false, info: null as WebPlaybackInfo | null, quality });
  live.current = { time, duration, paused, info, quality };
  const hideTimer = useRef<number | undefined>(undefined);
  const clickTimer = useRef<number | undefined>(undefined);
  const close = useRef(onClose);
  close.current = onClose;
  const handledMarkers = useRef(new Set<number>());
  const finished = useRef(false);

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
      playback.report(ratingKey, state, time * 1000, duration * 1000).catch(() => {});
    },
    [ratingKey],
  );

  const stopStream = useCallback(() => {
    hls.current?.destroy();
    hls.current = null;
    if (session.current) playback.stopTranscode(session.current).catch(() => {});
    session.current = null;
  }, []);

  /** (Re)starts Plex's transcode at `at` seconds, with the quality and tracks Plex has selected. */
  const startStream = useCallback(
    (q: WebQuality, at: number) => {
      const v = video.current;
      if (!v) return;
      stopStream();
      setBuffering(true);
      setError(null);
      const id = crypto.randomUUID();
      session.current = id;
      const url = transcodeUrl(ratingKey, { maxBitrateKbps: q.kbps, resolution: q.resolution, session: id });

      if (Hls.isSupported()) {
        const h = new Hls({ startPosition: at, maxBufferLength: 60 });
        hls.current = h;
        let recovered = false;
        h.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          if (!recovered && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            recovered = true;
            h.startLoad();
          } else if (!recovered && data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            recovered = true;
            h.recoverMediaError();
          } else {
            const status = data.response?.code ? ` (HTTP ${data.response.code})` : "";
            setError(`Plex couldn't stream this${status}: ${data.details}`);
          }
        });
        h.on(Hls.Events.MANIFEST_PARSED, () => {
          v.play().catch(() => setPaused(true));
        });
        h.loadSource(url);
        h.attachMedia(v);
      } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
        v.src = url;
        v.addEventListener("loadedmetadata", () => (v.currentTime = at), { once: true });
        v.play().catch(() => setPaused(true));
      } else {
        setError("This browser can't play HLS video.");
      }
    },
    [ratingKey, stopStream],
  );

  // Load the item, apply the language prefs, start streaming; tear down on close.
  useEffect(() => {
    let disposed = false;
    document.documentElement.classList.add("playing");

    (async () => {
      try {
        const [pi, prefs] = await Promise.all([getPlaybackInfo(ratingKey, playlist), loadPrefs()]);
        if (disposed) return;
        setInfo(pi);
        const tracks = initialTracks(pi, prefs);
        const plexAudio = pi.audioStreams.find((s) => s.selected)?.id;
        const plexSub = pi.subtitleStreams.find((s) => s.selected)?.id ?? 0;
        if (tracks.audio !== plexAudio || tracks.sub !== plexSub) {
          await selectStreams(pi.partId, { audioStreamID: tracks.audio, subtitleStreamID: tracks.sub }).catch(() => {});
        }
        setAudioId(tracks.audio);
        setSubId(tracks.sub);
        const q = WEB_QUALITIES.find((q) => q.label === prefs.quality) ?? WEB_QUALITIES[0];
        setQuality(q);
        if (disposed) return;
        startStream(q, resume ? pi.viewOffsetMs / 1000 : 0);
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
      window.removeEventListener("pagehide", onHide);
      if (finished.current) live.current.time = live.current.duration;
      report("stopped");
      stopStream();
      document.documentElement.classList.remove("playing");
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [ratingKey, resume, report, startStream, stopStream, playlist]);

  // Keep Plex's Continue Watching in step while playing.
  useEffect(() => {
    if (paused) {
      report("paused");
      return;
    }
    const t = window.setInterval(() => report("playing"), REPORT_EVERY_MS);
    return () => window.clearInterval(t);
  }, [paused, report]);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
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

  // Intro and credits markers: skip them, offer a button, or bring up Up Next.
  useEffect(() => {
    if (!info || !prefs || buffering) return;
    const ms = time * 1000;
    const i = info.markers.findIndex((m) => ms >= m.startTimeOffset && ms < m.endTimeOffset - 1000);
    const m = info.markers[i];
    const ending =
      m?.type === "credits" && (!!m.final || m.endTimeOffset >= info.durationMs - 5000) && prefs.skipCredits !== "off";

    if (ending) {
      setSkip(null);
      if (!handledMarkers.current.has(i)) {
        handledMarkers.current.add(i);
        setUpNext({ countdown: prefs.skipCredits === "auto" ? UP_NEXT_SECS : null });
      }
      return;
    }
    setUpNext(null);

    const mode = m?.type === "intro" ? prefs.skipIntro : m?.type === "credits" ? prefs.skipCredits : "off";
    const label = m?.type === "intro" ? "Skip intro" : "Skip credits";
    if (mode === "auto" && !handledMarkers.current.has(i)) {
      handledMarkers.current.add(i);
      seekTo(m.endTimeOffset / 1000);
      flash(m.type === "intro" ? "Skipped the intro" : "Skipped the credits");
      setSkip(null);
    } else if (mode !== "off") {
      setSkip({ label, to: m.endTimeOffset / 1000 });
    } else {
      setSkip(null);
    }
  }, [time, info, prefs, buffering, seekTo, flash]);

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
    (q: WebQuality) => {
      if (q.label === live.current.quality.label) return;
      setQuality(q);
      startStream(q, live.current.time);
    },
    [startStream],
  );

  // Plex picks the tracks on the server, so a change restarts the stream.
  const changeTracks = useCallback(
    async (patch: { audioStreamID?: number; subtitleStreamID?: number }) => {
      const pi = live.current.info;
      if (!pi) return;
      try {
        await selectStreams(pi.partId, patch);
        if (patch.audioStreamID !== undefined) setAudioId(patch.audioStreamID);
        if (patch.subtitleStreamID !== undefined) setSubId(patch.subtitleStreamID);
        startStream(live.current.quality, live.current.time);
      } catch (e) {
        flash(`Couldn't change track: ${errorMessage(e)}`);
      }
    },
    [startStream, flash],
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

      {notice && !error && (
        <div className="pointer-events-none absolute inset-x-0 top-24 flex justify-center px-6">
          <p className="max-w-lg rounded-xl bg-black/75 px-4 py-2.5 text-center text-sm text-white shadow-lg">{notice}</p>
        </div>
      )}

      {skip && !upNext && !error && (
        <Button
          size="lg"
          onClick={() => {
            seekTo(skip.to);
            setSkip(null);
          }}
          className={cn(
            "absolute right-8 z-10 bg-white text-black shadow-lg transition-[bottom] duration-300 hover:bg-white/90",
            controls ? "bottom-36" : "bottom-10",
          )}
        >
          <ChevronsRight /> {skip.label}
        </Button>
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
                <DropdownMenuLabel>Quality</DropdownMenuLabel>
                {WEB_QUALITIES.map((q) => (
                  <DropdownMenuCheckItem key={q.label} checked={q.label === quality.label} onSelect={() => changeQuality(q)}>
                    {q.name}
                  </DropdownMenuCheckItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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
