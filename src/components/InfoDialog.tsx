import { useEffect, useState } from "react";

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
};

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
    library
      .metadata(item.ratingKey)
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
                ["Year", m.year],
                ["Released", formatDate(m.originallyAvailableAt)],
                ["Runtime", formatDuration(m.duration)],
                ["Rating", m.contentRating],
                ["Critic score", m.rating != null ? m.rating.toFixed(1) : null],
                ["Audience score", m.audienceRating != null ? m.audienceRating.toFixed(1) : null],
                ["Studio", m.studio],
                ["Genres", m.Genre.map((g) => g.tag).join(", ")],
                ["Directors", m.Director.map((d) => d.tag).join(", ")],
                ["Seasons", m.type === "show" ? m.childCount : null],
                ["Episodes", m.type === "show" || m.type === "season" ? m.leafCount : null],
                ["Watched", watchedLabel(m)],
                ["Added", formatDate(m.addedAt)],
                ["Plex ID", m.ratingKey],
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
                    ["Container", (media.container ?? parts[0]?.container)?.toUpperCase()],
                    ["Resolution", resolutionLabel({ ...full, Media: [media] })],
                    ["Bitrate", formatBitrate(media.bitrate)],
                    ["Video", of(1).map(streamLabel).join("\n") || media.videoCodec?.toUpperCase()],
                    ["Audio", of(2).map(streamLabel).join("\n") || null],
                    ["Subtitles", of(3).map(streamLabel).join("\n") || null],
                  ].map(([k, v]) => [
                    k as string,
                    typeof v === "string" ? <span className="whitespace-pre-line">{v}</span> : v,
                  ])}
                />
              </Section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
