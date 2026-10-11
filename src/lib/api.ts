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
  videoCodec?: string | null;
  audioCodec?: string | null;
  audioChannels?: number | null;
  container?: string | null;
}

export type ItemType = "movie" | "show" | "season" | "episode" | string;

export interface Metadata {
  ratingKey: string;
  type: ItemType;
  title: string;
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
  studio?: string | null;
  originallyAvailableAt?: string | null;
  Genre: Tag[];
  Director: Tag[];
  Role: Tag[];
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
  collections: (section: string) => invoke<Metadata[]>("collections", { section }),
  collectionItems: (ratingKey: string) => invoke<Metadata[]>("collection_items", { ratingKey }),
  trailers: (ratingKey: string) => invoke<Metadata[]>("trailers", { ratingKey }),
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
