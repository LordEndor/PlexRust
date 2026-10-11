import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, library, type MediaStream, type Metadata } from "@/lib/api";
import { episodeLabel, formatDuration, isWatched, progress, resolutionLabel } from "@/lib/format";

function formatSize(bytes?: number | null) {
  if (!bytes) return null;
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

function formatBitrate(kbps?: number | null) {
  if (!kbps) return null;
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${kbps} kbps`;
}

function formatDate(value?: string | number | null) {
  if (!value) return null;
  const d = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

const TYPE_LABELS: Record<string, string> = {
  movie: "Movie",
  show: "TV show",
  season: "Season",
  episode: "Episode",
  collection: "Collection",
  playlist: "Playlist",
};

const CHANNELS: Record<number, string> = { 1: "Mono", 2: "Stereo", 6: "5.1", 8: "7.1" };

/** HDR format of a video track: Dolby Vision, HDR10, HLG or SDR. */
function hdrLabel(s: MediaStream) {
  if (s.DOVIProfile != null) return `Dolby Vision profile ${s.DOVIProfile}`;
  if (s.colorTrc === "smpte2084") return "HDR10";
  if (s.colorTrc === "arib-std-b67") return "HLG";
  return s.colorPrimaries || s.bitDepth ? "SDR" : null;
}

/** The video track in detail: "HEVC Main 10 · 3840×1608 · 10-bit · 23.976 fps · HDR10". */
function videoDetails(s: MediaStream) {
  return [
    [s.codec?.toUpperCase(), s.profile && s.profile.replace(/\b\w/g, (c) => c.toUpperCase())].filter(Boolean).join(" "),
    s.width && s.height ? `${s.width}×${s.height}` : null,
    s.bitDepth ? `${s.bitDepth}-bit` : null,
    s.chromaSubsampling,
    s.frameRate ? `${+s.frameRate.toFixed(3)} fps` : null,
    hdrLabel(s),
    formatBitrate(s.bitrate),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** An audio track: its title, then channels, sample rate and whether it plays by default. */
function audioDetails(s: MediaStream) {
  const extra = [
    s.audioChannelLayout ?? (s.channels ? (CHANNELS[s.channels] ?? `${s.channels} channels`) : null),
    s.samplingRate ? `${s.samplingRate / 1000} kHz` : null,
    formatBitrate(s.bitrate),
    s.default && "default",
  ]
    .filter(Boolean)
    .join(", ");
  const title = s.extendedDisplayTitle || s.displayTitle || s.codec?.toUpperCase() || "Unknown";
  return extra ? `${title} (${extra})` : title;
}

/** Links for the IDs Plex matched the item to. */
function externalIds(m: Metadata): [string, React.ReactNode][] {
  const sites: Record<string, [string, (id: string) => string]> = {
    imdb: ["IMDb", (id) => `https://www.imdb.com/title/${id}/`],
    tmdb: ["TMDB", (id) => `https://www.themoviedb.org/${m.type === "movie" ? "movie" : "tv"}/${id}`],
    tvdb: ["TVDB", (id) => `https://thetvdb.com/dereferrer/${m.type === "movie" ? "movie" : "series"}/${id}`],
  };
  return (m.Guid ?? []).flatMap(({ id }) => {
    const [scheme, value] = id.split("://");
    const site = sites[scheme];
    if (!site || !value) return [];
    const url = site[1](value);
    return [
      [
        site[0],
        <button key={id} className="text-primary hover:underline" onClick={() => openUrl(url).catch(() => {})}>
          {value}
        </button>,
      ] as [string, React.ReactNode],
    ];
  });
}

function tags(list?: { tag: string }[], max = 8) {
  if (!list?.length) return null;
  const names = list.slice(0, max).map((t) => t.tag);
  return list.length > max ? `${names.join(", ")} and ${list.length - max} more` : names.join(", ");
}

function formatRatio(r?: number | null) {
  return r ? `${r.toFixed(2)}:1` : null;
}

function watchedLabel(m: Metadata) {
  if (m.type === "show" || m.type === "season") {
    if (!m.leafCount) return null;
    return `${m.viewedLeafCount ?? 0} of ${m.leafCount} episodes watched`;
  }
  if (progress(m) > 0) return `In progress, ${formatDuration(m.viewOffset)} in`;
  if (isWatched(m)) return m.viewCount && m.viewCount > 1 ? `Watched ${m.viewCount} times` : "Watched";
  return "Unwatched";
}

/** Rows of label and value; rows without a value are left out. */
function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  const shown = rows.filter(([, v]) => v != null && v !== "");
  if (shown.length === 0) return null;
  return (
    <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-1.5 text-sm">
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function streamLabel(s: MediaStream) {
  const title = s.extendedDisplayTitle || s.displayTitle || s.codec?.toUpperCase() || "Unknown";
  const extra = [s.forced && "forced", formatBitrate(s.bitrate)].filter(Boolean).join(", ");
  return extra ? `${title} (${extra})` : title;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/** Everything Plex knows about an item: details, files and tracks. */
export function InfoDialog({
  item,
  open,
  onOpenChange,
}: {
  item: Metadata;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [full, setFull] = useState<Metadata | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    (item.type === "playlist" ? library.playlist(item.ratingKey) : library.metadata(item.ratingKey))
      .then(setFull)
      .catch((e) => setError(errorMessage(e)));
  }, [open, item.ratingKey]);

  const m = full ?? item;
  const heading = m.type === "episode" ? `${m.grandparentTitle} · ${episodeLabel(m)}` : (TYPE_LABELS[m.type] ?? m.type);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="flex flex-col gap-1 border-b px-6 pt-5 pb-4">
          <DialogTitle>{m.title}</DialogTitle>
          <DialogDescription>{heading}</DialogDescription>
        </div>
        <div className="flex flex-col gap-6 overflow-y-auto px-6 py-5">
          <Section title="Details">
            <Facts
              rows={[
                ["Original title", m.originalTitle !== m.title ? m.originalTitle : null],
                ["Edition", m.editionTitle],
                ["Library", m.librarySectionTitle],
                ["Year", m.year],
                [m.type === "show" ? "First aired" : m.type === "episode" ? "Aired" : "Released", formatDate(m.originallyAvailableAt)],
                ["Runtime", formatDuration(m.duration)],
                ["Content rating", m.contentRating],
                ["Critic score", m.rating != null ? m.rating.toFixed(1) : null],
                ["Audience score", m.audienceRating != null ? m.audienceRating.toFixed(1) : null],
                ["Your rating", m.userRating != null ? `${m.userRating / 2} / 5 stars` : null],
                ["Studio", m.studio],
                ["Country", tags(m.Country)],
                ["Genres", tags(m.Genre)],
                ["Directors", tags(m.Director)],
                ["Writers", tags(m.Writer)],
                ["Producers", tags(m.Producer, 5)],
                ["Cast", tags(m.Role, 6)],
                ["Collections", tags(m.Collection)],
                ["Labels", tags(m.Label)],
                ["Seasons", m.type === "show" ? m.childCount : null],
                ["Episodes", m.type === "show" || m.type === "season" ? m.leafCount : null],
                ["Items", m.type === "playlist" || m.type === "collection" ? (m.leafCount ?? m.childCount) : null],
              ]}
            />
          </Section>

          <Section title="Watch history">
            <Facts
              rows={[
                ["Watched", m.type === "playlist" || m.type === "collection" ? null : watchedLabel(m)],
                ["Last watched", formatDate(m.lastViewedAt)],
                ["Added", formatDate(m.addedAt)],
                ["Updated", formatDate(m.updatedAt)],
              ]}
            />
          </Section>

          {m.summary && (
            <Section title="Summary">
              <p className="text-muted-foreground text-sm leading-relaxed">{m.summary}</p>
            </Section>
          )}

          {!full && !error && (m.type === "movie" || m.type === "episode") && <Skeleton className="h-32" />}
          {error && <p className="text-destructive text-sm">Couldn't load the file details: {error}</p>}

          {full?.Media.map((media, i) => {
            const parts = media.Part ?? [];
            const streams = parts.flatMap((p) => p.Stream ?? []);
            const of = (type: number) => streams.filter((s) => s.streamType === type);
            return (
              <Section key={i} title={full.Media.length > 1 ? `Version ${i + 1}` : "File"}>
                <Facts
                  rows={[
                    [
                      "Path",
                      parts
                        .map((p) => p.file)
                        .filter(Boolean)
                        .join("\n") || null,
                    ],
                    ["Size", formatSize(parts.reduce((n, p) => n + (p.size ?? 0), 0))],
                    ["Duration", formatDuration(media.duration ?? parts[0]?.duration)],
                    ["Container", (media.container ?? parts[0]?.container)?.toUpperCase()],
                    [
                      "Resolution",
                      [resolutionLabel({ ...full, Media: [media] }), media.width && media.height && `${media.width}×${media.height}`]
                        .filter(Boolean)
                        .join(" · ") || null,
                    ],
                    ["Aspect ratio", formatRatio(media.aspectRatio)],
                    ["Frame rate", media.videoFrameRate],
                    ["Bitrate", formatBitrate(media.bitrate)],
                    ["Video", of(1).map(videoDetails).join("\n") || media.videoCodec?.toUpperCase()],
                    ["Audio", of(2).map(audioDetails).join("\n") || null],
                    ["Subtitles", of(3).map(streamLabel).join("\n") || null],
                  ].map(([k, v]) => [
                    k as string,
                    typeof v === "string" ? <span className="whitespace-pre-line">{v}</span> : v,
                  ])}
                />
              </Section>
            );
          })}
          <Section title="IDs">
            <Facts rows={[["Plex ID", m.ratingKey], ...externalIds(m)]} />
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
