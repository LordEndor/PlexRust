import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { transcodeSessionInfo } from "../plex";
import type { PlaybackPlan, SourceMedia, SubtitleDelivery, TranscodeSessionInfo } from "./types";

export interface StatsOverlayProps {
  plan: PlaybackPlan;
  source: SourceMedia;
  /** Plex transcode session id; null in direct play. */
  session: string | null;
  video: HTMLVideoElement | null;
  onClose: () => void;
}

interface PlayerStats {
  width: number;
  height: number;
  dropped: number | null;
  total: number | null;
  bufferAhead: number;
}

const PLEX_POLL_MS = 2000;
const PLAYER_POLL_MS = 1000;

/** Live Plex numbers for the session, polled every 2 s. Null until the first answer. */
function usePlexStats(session: string | null): TranscodeSessionInfo | null {
  const [info, setInfo] = useState<TranscodeSessionInfo | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const poll = () => {
      transcodeSessionInfo(session).then(
        (next) => {
          if (!cancelled) setInfo(next);
        },
        () => {
          if (!cancelled) setInfo(null);
        },
      );
    };
    poll();
    const id = window.setInterval(poll, PLEX_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [session]);

  return session ? info : null;
}

/** Seconds of video buffered past the playhead. */
function bufferAhead(video: HTMLVideoElement): number {
  const now = video.currentTime;
  const ranges = video.buffered;
  for (let i = 0; i < ranges.length; i++) {
    const start = ranges.start(i);
    const end = ranges.end(i);
    if (now >= start && now <= end) return end - now;
  }
  return 0;
}

/** Element size, frame counts and buffer, refreshed every second. */
function usePlayerStats(video: HTMLVideoElement | null): PlayerStats | null {
  const [stats, setStats] = useState<PlayerStats | null>(null);

  useEffect(() => {
    if (!video) return;
    const read = () => {
      try {
        let dropped: number | null = null;
        let total: number | null = null;
        if (typeof video.getVideoPlaybackQuality === "function") {
          const quality = video.getVideoPlaybackQuality();
          dropped = quality.droppedVideoFrames;
          total = quality.totalVideoFrames;
        }
        setStats({
          width: video.videoWidth,
          height: video.videoHeight,
          dropped,
          total,
          bufferAhead: bufferAhead(video),
        });
      } catch {
        setStats(null);
      }
    };
    read();
    const id = window.setInterval(read, PLAYER_POLL_MS);
    return () => window.clearInterval(id);
  }, [video]);

  return video ? stats : null;
}

function mbps(kbps: number): string {
  return `${(kbps / 1000).toFixed(1)} Mbps`;
}

function upper(codec: string): string {
  return codec.toUpperCase();
}

function channelLabel(channels: number): string {
  switch (channels) {
    case 1:
      return "mono";
    case 2:
      return "stereo";
    case 6:
      return "5.1";
    case 8:
      return "7.1";
    default:
      return `${channels}ch`;
  }
}

function plexOutput(plex: TranscodeSessionInfo | null): string {
  if (!plex) return "—";
  const codecs = [plex.videoCodec, plex.audioCodec].filter((c): c is string => Boolean(c));
  return codecs.length > 0 ? codecs.map(upper).join(" / ") : "—";
}

function subtitleText(delivery: SubtitleDelivery): string {
  switch (delivery.kind) {
    case "none":
      return "none";
    case "sidecar":
      return "shown by browser";
    case "burn":
      return "burned in";
  }
}

function modeText(plan: PlaybackPlan): string {
  switch (plan.mode) {
    case "directPlay":
      return "Direct play";
    case "directStream":
      return "Direct stream";
    case "transcode":
      return "Transcode";
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-t border-white/10 pt-2 first:border-t-0 first:pt-0">
      <div className="text-[10px] font-medium tracking-wide text-white/50 uppercase">{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-white/60">{label}</span>
      <span className="text-right font-mono tabular-nums break-all">{value}</span>
    </div>
  );
}

/** "Stats for nerds": how this file is playing and why. */
export function StatsOverlay({ plan, source, session, video, onClose }: StatsOverlayProps) {
  const plex = usePlexStats(session);
  const player = usePlayerStats(video);

  const hdrTag = source.dolbyVision ? "Dolby Vision" : source.hdr ? "HDR" : null;
  const transcoding = plan.mode === "transcode";

  return (
    <div className="pointer-events-auto absolute top-4 left-4 z-20 max-w-[22rem] rounded-lg bg-black/75 p-3 text-xs text-white shadow-lg">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="font-semibold">Stats for nerds</span>
        <button
          type="button"
          onClick={onClose}
          title="Close stats"
          aria-label="Close stats"
          className="-m-1 rounded p-1 text-white/70 hover:bg-white/10 hover:text-white"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <Section title="Mode">
          <Row label="Mode" value={modeText(plan)} />
          {plan.reasons.length > 0 && (
            <ul className="list-disc pl-4 text-white/80">
              {plan.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Source">
          <Row label="Video" value={`${upper(source.videoCodec)}${hdrTag ? ` · ${hdrTag}` : ""}`} />
          <Row label="Resolution" value={`${source.width} x ${source.height}`} />
          <Row label="Bitrate" value={mbps(source.bitrateKbps)} />
          <Row label="Audio" value={`${upper(source.audioCodec)} ${channelLabel(source.audioChannels)}`} />
          <Row label="Container" value={source.container} />
        </Section>

        <Section title="Output">
          <Row label="Video" value={upper(plan.videoCodecOut)} />
          <Row label="Audio" value={upper(plan.audioCodecOut)} />
          {transcoding && <Row label="Max size" value={`${plan.maxWidth} x ${plan.maxHeight}`} />}
          {transcoding && (
            <Row label="Bitrate cap" value={plan.maxBitrateKbps == null ? "uncapped" : mbps(plan.maxBitrateKbps)} />
          )}
          <Row label="Subtitles" value={subtitleText(plan.subtitles)} />
        </Section>

        {session !== null && (
          <Section title="Plex">
            <Row label="Video" value={plex?.videoDecision ?? "—"} />
            <Row label="Audio" value={plex?.audioDecision ?? "—"} />
            <Row label="Output" value={plexOutput(plex)} />
            <Row
              label="Size"
              value={plex?.width && plex?.height ? `${plex.width} x ${plex.height}` : "—"}
            />
            <Row label="Speed" value={plex?.speed != null ? `${plex.speed.toFixed(1)}x` : "—"} />
            {(plex?.transcodeHwFullPipeline || plex?.transcodeHwRequested) && <Row label="Hardware" value="yes" />}
            {plex?.throttled && <Row label="Throttled" value="yes" />}
          </Section>
        )}

        <Section title="Player">
          <Row
            label="Rendered"
            value={player ? `${player.width} x ${player.height}` : "—"}
          />
          <Row
            label="Dropped frames"
            value={player?.dropped != null && player.total != null ? `${player.dropped} / ${player.total}` : "—"}
          />
          <Row label="Buffer ahead" value={player ? `${player.bufferAhead.toFixed(1)} s` : "—"} />
        </Section>
      </div>
    </div>
  );
}
