import { convertFileSrc, invoke } from "@tauri-apps/api/core";

import { webImageUrl } from "@/web/plex";

export interface User {
  id: number;
  uuid: string;
  username: string;
  title: string;
  email?: string | null;
  thumb?: string | null;
}

export interface ServerConnection {
  machineId: string;
  name: string;
  uri: string;
  token: string;
  local: boolean;
  relay: boolean;
}

export interface Session {
  user: User | null;
  server: ServerConnection | null;
}

export interface AuthStart {
  pinId: number;
  code: string;
  url: string;
}

export interface ServerSummary {
  machineId: string;
  name: string;
  owned: boolean;
  online: boolean;
  version: string;
  platform?: string | null;
}

export interface LibrarySection {
  key: string;
  type: "movie" | "show" | "artist" | "photo" | string;
  title: string;
}

/** Typed wrappers around the Rust commands in `src-tauri/src/commands.rs`. */
export const api = {
  getSession: () => invoke<Session>("get_session"),
  authStart: () => invoke<AuthStart>("auth_start"),
  authWait: (pinId: number, code: string) => invoke<User>("auth_wait", { pinId, code }),
  signOut: () => invoke<void>("sign_out"),
  listServers: () => invoke<ServerSummary[]>("list_servers"),
  selectServer: (machineId: string) => invoke<ServerConnection>("select_server", { machineId }),
  librarySections: () => invoke<LibrarySection[]>("library_sections"),
};

export function errorMessage(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}

export interface Tag {
  tag: string;
  role?: string | null;
  thumb?: string | null;
}

export interface Media {
  videoResolution?: string | null;
  width?: number | null;
  height?: number | null;
  aspectRatio?: number | null;
  /** Such as `24p` or `PAL`. */
  videoFrameRate?: string | null;
  videoProfile?: string | null;
  /** Milliseconds. */
  duration?: number | null;
  /** Overall bitrate in kbps. */
  bitrate?: number | null;
  videoCodec?: string | null;
  audioCodec?: string | null;
  audioChannels?: number | null;
  container?: string | null;
  Part?: MediaPart[];
}

/** One file of a media version. */
export interface MediaPart {
  file?: string | null;
  size?: number | null;
  /** Milliseconds. */
  duration?: number | null;
  container?: string | null;
  Stream?: MediaStream[];
}

export interface MediaStream {
  /** 1 video, 2 audio, 3 subtitle. */
  streamType?: number | null;
  codec?: string | null;
  displayTitle?: string | null;
  extendedDisplayTitle?: string | null;
  /** Kbps. */
  bitrate?: number | null;
  forced?: boolean | null;
  default?: boolean | null;
  /** Codec profile, such as `main 10` or `dts-hd ma`. */
  profile?: string | null;
  bitDepth?: number | null;
  frameRate?: number | null;
  width?: number | null;
  height?: number | null;
  /** `bt2020` for HDR. */
  colorPrimaries?: string | null;
  /** `smpte2084` for HDR10 and Dolby Vision, `arib-std-b67` for HLG. */
  colorTrc?: string | null;
  chromaSubsampling?: string | null;
  channels?: number | null;
  audioChannelLayout?: string | null;
  /** Hz. */
  samplingRate?: number | null;
  DOVIProfile?: number | null;
}

export type ItemType = "movie" | "show" | "season" | "episode" | "collection" | "playlist" | string;

export interface Metadata {
  ratingKey: string;
  type: ItemType;
  title: string;
  originalTitle?: string | null;
  /** Such as "Director's Cut". */
  editionTitle?: string | null;
  librarySectionTitle?: string | null;
  parentRatingKey?: string | null;
  grandparentRatingKey?: string | null;
  parentTitle?: string | null;
  grandparentTitle?: string | null;
  summary?: string | null;
  tagline?: string | null;
  year?: number | null;
  thumb?: string | null;
  art?: string | null;
  parentThumb?: string | null;
  grandparentThumb?: string | null;
  grandparentArt?: string | null;
  /** A playlist's poster, a mosaic of what's in it. */
  composite?: string | null;
  duration?: number | null;
  viewOffset?: number | null;
  viewCount?: number | null;
  index?: number | null;
  parentIndex?: number | null;
  leafCount?: number | null;
  viewedLeafCount?: number | null;
  childCount?: number | null;
  contentRating?: string | null;
  rating?: number | null;
  audienceRating?: number | null;
  /** The account's own star rating, 0 to 10. */
  userRating?: number | null;
  studio?: string | null;
  originallyAvailableAt?: string | null;
  /** Unix seconds. */
  addedAt?: number | null;
  /** Unix seconds. */
  updatedAt?: number | null;
  /** Unix seconds. */
  lastViewedAt?: number | null;
  playlistType?: string | null;
  Genre: Tag[];
  Director: Tag[];
  Role: Tag[];
  Writer?: Tag[];
  Producer?: Tag[];
  Country?: Tag[];
  Collection?: Tag[];
  Label?: Tag[];
  /** IDs in other databases, such as `imdb://tt0369339`. */
  Guid?: { id: string }[];
  Media: Media[];
  /** For extras: 1 is a trailer. */
  extraType?: number | null;
}

export interface Hub {
  hubIdentifier: string;
  title: string;
  type: string;
  Metadata: Metadata[];
}

/** What a library listing is narrowed down to. */
export interface Filters {
  genre?: string | null;
  decade?: string | null;
  /** `4k`, `1080`, `720`, `480` or `sd`. */
  resolution?: string | null;
  unwatched?: boolean;
  minBitrateKbps?: number | null;
}

/** One value a library can be filtered by, such as a genre. */
export interface FilterValue {
  key: string;
  title: string;
}

export interface Page {
  items: Metadata[];
  total: number;
}

export const library = {
  homeHubs: () => invoke<Hub[]>("home_hubs"),
  sectionItems: (section: string, start: number, size: number, sort = "titleSort", filters?: Filters) =>
    invoke<Page>("section_items", { section, start, size, sort, filters }),
  filterValues: (section: string, field: "genre" | "decade") =>
    invoke<FilterValue[]>("filter_values", { section, field }),
  /** Movies or shows in a library, or with `kind` items of that Plex type (4 is episodes). */
  sectionCount: (section: string, kind?: number) => invoke<number>("section_count", { section, kind }),
  collections: (section: string) => invoke<Metadata[]>("collections", { section }),
  playlists: () => invoke<Metadata[]>("playlists"),
  playlist: (ratingKey: string) => invoke<Metadata>("playlist", { ratingKey }),
  playlistItems: (ratingKey: string) => invoke<Metadata[]>("playlist_items", { ratingKey }),
  collectionItems: (ratingKey: string) => invoke<Metadata[]>("collection_items", { ratingKey }),
  trailers: (ratingKey: string) => invoke<Metadata[]>("trailers", { ratingKey }),
  setWatched: (ratingKey: string, watched: boolean) => invoke<void>("set_watched", { ratingKey, watched }),
  removeFromContinueWatching: (ratingKey: string) => invoke<void>("remove_from_continue_watching", { ratingKey }),
  /** The episode a show or season's Play button starts; null once all are watched. */
  upNext: (ratingKey: string) => invoke<Metadata | null>("up_next", { ratingKey }),
  metadata: (ratingKey: string) => invoke<Metadata>("metadata", { ratingKey }),
  children: (ratingKey: string) => invoke<Metadata[]>("children", { ratingKey }),
  search: (query: string) => invoke<Hub[]>("search", { query }),
};

/**
 * URL for a Plex image, resized on the server to the size it is shown at.
 * It points at the app's `plximg` protocol: Rust fetches and caches the image,
 * so the page never connects to the Plex server or sees the token. The
 * browser version has no Rust side, so it asks Plex directly.
 */
export function imageUrl(server: ServerConnection, path: string | null | undefined, width: number, height: number) {
  if (!path) return undefined;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (import.meta.env.MODE === "web") {
    return webImageUrl(server, path, Math.round(width * dpr), Math.round(height * dpr));
  }
  const params = new URLSearchParams({
    s: server.machineId,
    w: String(Math.round(width * dpr)),
    h: String(Math.round(height * dpr)),
    url: path,
  });
  return `${convertFileSrc("", "plximg")}?${params}`;
}
