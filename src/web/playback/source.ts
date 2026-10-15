import type { WebPlaybackInfo } from "@/web/plex";
import type { SourceMedia } from "./types";

/** The file as it will play with these audio and subtitle streams (0 or undefined = Plex's pick / none). */
export function sourceFor(info: WebPlaybackInfo, audioId: number | undefined, subtitleId: number): SourceMedia {
  const { file } = info;
  const v = file.videoStream;
  const audio = info.audioStreams.find((s) => s.id === audioId) ?? info.audioStreams.find((s) => s.selected) ?? info.audioStreams[0];
  const sub = subtitleId ? info.subtitleStreams.find((s) => s.id === subtitleId) : undefined;
  const trc = v?.colorTrc?.toLowerCase();
  return {
    partKey: file.partKey,
    partId: info.partId,
    container: file.container,
    videoCodec: file.videoCodec,
    videoProfile: v?.profile?.toLowerCase(),
    bitDepth: v?.bitDepth,
    hdr: trc === "smpte2084" || trc === "arib-std-b67" || !!v?.DOVIPresent,
    dolbyVision: !!v?.DOVIPresent,
    width: file.width,
    height: file.height,
    bitrateKbps: file.bitrateKbps,
    audioCodec: (audio?.codec ?? "").toLowerCase(),
    audioChannels: audio?.channels ?? 2,
    subtitle: sub
      ? {
          streamId: sub.id,
          codec: (sub.codec ?? "").toLowerCase(),
          external: !!sub.key,
          forced: sub.forced,
          languageCode: sub.languageCode,
        }
      : null,
  };
}
