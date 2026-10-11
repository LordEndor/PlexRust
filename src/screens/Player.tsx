import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  Captions,
  Gauge,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
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
import { errorMessage } from "@/lib/api";
import { formatTime, playback, QUALITIES, type PlaybackInfo, type PlaybackState, type Quality } from "@/lib/player";
import { cn } from "@/lib/utils";

const OBSERVED = ["pause", "time-pos", "duration", "track-list", "paused-for-cache", "volume", "mute", "eof-reached"] as const;

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
];

const REPORT_EVERY_MS = 10_000;
/** Give up on a file that hasn't started after this long and try transcoding. */
const LOAD_TIMEOUT_MS = 45_000;
/** What to fall back to when the original file won't play. */
const FALLBACK = QUALITIES[1];
const HIDE_CONTROLS_MS = 3000;

interface Track {
  id: number;
  type: "video" | "audio" | "sub";
  title?: string;
  lang?: string;
  codec?: string;
  selected?: boolean;
  external?: boolean;
  "demux-channel-count"?: number;
}

function trackLabel(t: Track) {
  const parts = [t.title, t.lang?.toUpperCase(), t.codec?.toUpperCase()].filter(Boolean);
  if (t.type === "audio" && t["demux-channel-count"]) parts.push(`${t["demux-channel-count"]}ch`);
  return parts.join(" · ") || `Track ${t.id}`;
}

interface Props {
  ratingKey: string;
  resume: boolean;
  onClose: () => void;
}

export function Player({ ratingKey, resume, onClose }: Props) {
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

  // Latest values for timers and cleanup, which outlive any one render.
  const live = useRef({ time: 0, duration: 0, paused: false, info: null as PlaybackInfo | null });
  live.current = { time, duration: duration || (info?.durationMs ?? 0) / 1000, paused, info };
  const session = useRef(crypto.randomUUID());
  const transcoding = useRef(false);
  const hideTimer = useRef<number | undefined>(undefined);
  const clickTimer = useRef<number | undefined>(undefined);
  const close = useRef(onClose);
  close.current = onClose;

  const report = useCallback(
    (state: PlaybackState) => {
      const { time, duration } = live.current;
      if (!duration) return;
      playback.report(ratingKey, state, time * 1000, duration * 1000).catch(() => {});
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
        const pi = await playback.info(ratingKey);
        if (disposed) return;
        setInfo(pi);
        const args = pi.logPath ? [...MPV_ARGS, `--log-file=${pi.logPath}`] : MPV_ARGS;
        const config: MpvConfig = { path: pi.mpvPath, args, observedProperties: OBSERVED, ipcTimeoutMs: 5000 };
        await init(config);
        if (disposed) return destroy();

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
              case "eof-reached":
                if (data) {
                  report("stopped");
                  close.current();
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
                  command("sub-add", [s.url, "auto", s.title, s.language ?? ""]).catch(() => {});
                }
              }
            }
          }),
        );

        if (pi.stripDolbyVision) await setProperty<string>("vf", "format:dolbyvision=no");
        await load(pi.url, start);
      } catch (e) {
        if (!disposed) setError(errorMessage(e));
      }
    })();

    return () => {
      disposed = true;
      report("stopped");
      unlisten.forEach((u) => u());
      destroy().catch(() => {});
      if (transcoding.current) playback.stopTranscode(session.current).catch(() => {});
      document.documentElement.classList.remove("playing");
      getCurrentWindow()
        .setFullscreen(false)
        .catch(() => {});
    };
  }, [ratingKey, resume, report]);

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

  const toggleFullscreen = useCallback(async () => {
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

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      poke();
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
        case "Escape":
          if (await getCurrentWindow().isFullscreen()) toggleFullscreen();
          else onClose();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [poke, togglePause, seekBy, toggleFullscreen, onClose]);

  const audio = tracks.filter((t) => t.type === "audio");
  const subs = tracks.filter((t) => t.type === "sub");
  const total = duration || (info?.durationMs ?? 0) / 1000;

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
          <SeekBar time={time} duration={total} onSeek={seekTo} />
          <div className="flex items-center gap-1 text-white">
            <IconButton title="Back 10s (←)" onClick={() => seekBy(-10)}>
              <RotateCcw />
            </IconButton>
            <IconButton title={paused ? "Play (Space)" : "Pause (Space)"} onClick={togglePause} big>
              {paused ? <Play className="fill-current" /> : <Pause className="fill-current" />}
            </IconButton>
            <IconButton title="Forward 10s (→)" onClick={() => seekBy(10)}>
              <RotateCw />
            </IconButton>
            <span className="ml-3 text-sm text-white/80 tabular-nums">
              {formatTime(time)} / {formatTime(total)}
            </span>

            <div className="flex-1" />

            <IconButton title="Mute (M)" onClick={() => command("cycle", ["mute"]).catch(() => {})}>
              {muted || volume === 0 ? <VolumeX /> : <Volume2 />}
            </IconButton>
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

            <TrackMenu icon={<AudioLines />} title="Audio" tracks={audio} onPick={(id) => setProperty<number | string>("aid", id ?? "auto")} />
            <TrackMenu
              icon={<Captions />}
              title="Subtitles"
              tracks={subs}
              allowOff
              onPick={(id) => setProperty<number | string>("sid", id ?? "no")}
            />
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
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  big?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      title={title}
      onClick={onClick}
      className={cn("text-white hover:bg-white/10", big && "size-11 [&_svg:not([class*='size-'])]:size-6")}
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
}: {
  icon: React.ReactNode;
  title: string;
  tracks: Track[];
  allowOff?: boolean;
  onPick: (id: number | undefined) => Promise<void>;
}) {
  const none = !tracks.some((t) => t.selected);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title={title}
          disabled={tracks.length === 0}
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
