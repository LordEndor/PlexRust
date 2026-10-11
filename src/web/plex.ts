/**
 * The browser build's stand-in for the Rust side: the same commands as
 * `src-tauri/src/commands.rs`, talking to plex.tv and the Plex server
 * straight from the page. Everything is kept in localStorage.
 *
 * Plex's identification headers and the token travel as query parameters, so
 * plain GETs stay "simple" requests and skip the CORS preflight.
 */
import type {
  AuthStart,
  FilterValue,
  Filters,
  Hub,
  LibrarySection,
  Metadata,
  Page,
  ServerConnection,
  ServerSummary,
  Session,
  User,
} from "@/lib/api";
import type { Episode, Marker, PlaybackInfo } from "@/lib/player";
import { DEFAULT_PREFS, type Prefs } from "@/lib/prefs";

const PLEX_TV = "https://plex.tv";
const CLIENTS_PLEX_TV = "https://clients.plex.tv";
const PROBE_TIMEOUT_MS = 4000;
const REQUEST_TIMEOUT_MS = 20_000;

const KEYS = { clientId: "plexrust.clientId", session: "plexrust.session", prefs: "plexrust.prefs" };

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows can refuse storage; the app still works until reload.
  }
}

interface Stored {
  token?: string | null;
  user?: User | null;
  server?: ServerConnection | null;
}

let memory: Stored = read<Stored>(KEYS.session) ?? {};
function stored() {
  return memory;
}
function store(patch: Partial<Stored>) {
  memory = { ...memory, ...patch };
  write(KEYS.session, memory);
}

export function clientId(): string {
  let id = read<string>(KEYS.clientId);
  if (!id) {
    id = crypto.randomUUID();
    write(KEYS.clientId, id);
  }
  return id;
}

/** What Plex shows for this device under Authorized Devices and Now Playing. */
export function clientParams(): Record<string, string> {
  return {
    "X-Plex-Client-Identifier": clientId(),
    "X-Plex-Product": "PlexRust",
    "X-Plex-Version": import.meta.env.VITE_APP_VERSION || "web",
    "X-Plex-Platform": "Chrome",
    "X-Plex-Device": "Web",
    "X-Plex-Device-Name": "PlexRust (browser)",
  };
}

type Params = Record<string, string | number | undefined>;

function buildUrl(base: string, path: string, params: Params = {}, token?: string) {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  for (const [k, v] of Object.entries(clientParams())) url.searchParams.set(k, v);
  if (token) url.searchParams.set("X-Plex-Token", token);
  return url.toString();
}

async function request<T>(
  url: string,
  { method = "GET", timeout = REQUEST_TIMEOUT_MS, json = true }: { method?: string; timeout?: number; json?: boolean } = {},
): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(url, { method, headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    const host = new URL(url).host;
    throw new Error(
      e instanceof DOMException && e.name === "TimeoutError"
        ? `${host} didn't answer in time`
        : `Couldn't reach ${host}. The browser may be blocking it, or the server is offline.`,
    );
  }
  if (resp.status === 401) throw new Error("Plex rejected the sign-in. Try signing out and in again.");
  if (!resp.ok) throw new Error(`Plex answered ${resp.status} ${resp.statusText}`.trim());
  if (!json) return undefined as T;
  const text = await resp.text();
  return (text ? JSON.parse(text) : {}) as T;
}

// ---------------------------------------------------------------------------
// Account and servers

interface Pin {
  id: number;
  code: string;
  authToken?: string | null;
}

interface Connection {
  uri: string;
  local?: boolean;
  relay?: boolean;
  IPv6?: boolean;
}

interface Resource {
  name: string;
  clientIdentifier: string;
  productVersion?: string;
  platform?: string | null;
  provides?: string;
  owned?: boolean;
  presence?: boolean;
  accessToken?: string | null;
  connections?: Connection[];
}

function accountToken() {
  const token = stored().token;
  if (!token) throw new Error("Not signed in");
  return token;
}

function currentServer() {
  const server = stored().server;
  if (!server) throw new Error("No server selected");
  return server;
}

async function servers(): Promise<Resource[]> {
  const url = (base: string) =>
    buildUrl(base, "/api/v2/resources", { includeHttps: 1, includeRelay: 1, includeIPv6: 1 }, accountToken());
  // plex.tv serves the same list, in case clients.plex.tv turns the page away.
  const all = await request<Resource[]>(url(CLIENTS_PLEX_TV)).catch(() => request<Resource[]>(url(PLEX_TV)));
  return all.filter((r) => (r.provides ?? "").split(",").includes("server"));
}

async function probe(conn: Connection, token: string): Promise<number | null> {
  const start = performance.now();
  try {
    await request(buildUrl(conn.uri.replace(/\/$/, ""), "/identity", {}, token), { timeout: PROBE_TIMEOUT_MS, json: false });
    return performance.now() - start;
  } catch {
    return null;
  }
}

/** Same order as the desktop app: direct before relay, LAN before WAN, IPv4 before IPv6, then fastest. */
function rank(c: Connection, latency: number) {
  return [Number(!!c.relay), Number(!c.local), Number(!!c.IPv6), latency];
}

function compareRanks(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

async function connect(server: Resource): Promise<ServerConnection> {
  const token = server.accessToken || accountToken();
  // An https page may only call https addresses; Plex's *.plex.direct ones
  // have real certificates, including for LAN IPs.
  const usable = (server.connections ?? []).filter((c) => location.protocol !== "https:" || c.uri.startsWith("https:"));
  const results = await Promise.all(usable.map((c) => probe(c, token)));
  const ok = usable
    .map((c, i) => ({ c, latency: results[i] }))
    .filter((r): r is { c: Connection; latency: number } => r.latency !== null)
    .sort((a, b) => compareRanks(rank(a.c, a.latency), rank(b.c, b.latency)));
  const best = ok[0]?.c;
  if (!best) {
    throw new Error(
      "Couldn't reach the server from this browser. If you're on a work computer, allow the site to reach devices on your local network when the browser asks.",
    );
  }
  return {
    machineId: server.clientIdentifier,
    name: server.name,
    uri: best.uri.replace(/\/$/, ""),
    token,
    local: !!best.local,
    relay: !!best.relay,
  };
}

// ---------------------------------------------------------------------------
// Library

/** Fills in the arrays the Rust side always sends, even when Plex leaves them out. */
function meta(m: Partial<Metadata>): Metadata {
  return { ...m, Genre: m.Genre ?? [], Director: m.Director ?? [], Role: m.Role ?? [], Media: m.Media ?? [] } as Metadata;
}

interface Container {
  totalSize?: number;
  size?: number;
  Metadata?: (Omit<Metadata, "Media"> & RawExtras)[];
  Hub?: (Hub & { Metadata?: Metadata[] })[];
  Directory?: (LibrarySection & FilterValue)[];
}

/** Fields the UI types don't carry but playback needs. */
interface RawExtras {
  Marker?: Marker[];
  Media: (Omit<Metadata["Media"][number], "Part"> & { Part?: RawPart[] })[];
}

interface RawPart {
  id: number;
  key: string;
  Stream?: RawStream[];
}

export interface RawStream {
  id: number;
  streamType: number;
  codec?: string;
  languageCode?: string;
  displayTitle?: string;
  extendedDisplayTitle?: string;
  title?: string;
  selected?: boolean;
  forced?: boolean;
  channels?: number;
}

async function container(path: string, params: Params = {}): Promise<Container> {
  const server = currentServer();
  const body = await request<{ MediaContainer?: Container }>(buildUrl(server.uri, path, params, server.token));
  return body.MediaContainer ?? {};
}

function hubs(c: Container): Hub[] {
  return (c.Hub ?? [])
    .map((h) => ({ ...h, Metadata: (h.Metadata ?? []).map(meta) }))
    .filter((h) => h.Metadata.length > 0);
}

async function metadataRaw(ratingKey: string) {
  const c = await container(`/library/metadata/${ratingKey}`, { includeMarkers: 1 });
  const item = c.Metadata?.[0];
  if (!item) throw new Error("That item no longer exists on the server");
  return item;
}

async function children(ratingKey: string): Promise<Metadata[]> {
  const c = await container(`/library/metadata/${ratingKey}/children`);
  return (c.Metadata ?? []).map(meta);
}

/**
 * The episodes around `ep` in its show: the one before it and every one
 * after it, in order. Specials only count when `ep` is itself a special.
 */
interface Neighbours {
  previous?: Metadata;
  after: Metadata[];
}

async function episodeNeighbours(ep: Metadata): Promise<Neighbours> {
  if (!ep.grandparentRatingKey) return { after: [] };
  const specials = ep.parentIndex === 0;
  const all = ((await container(`/library/metadata/${ep.grandparentRatingKey}/allLeaves`)).Metadata ?? [])
    .map(meta)
    .filter((m) => (m.parentIndex === 0) === specials)
    .sort((a, b) => (a.parentIndex ?? 0) - (b.parentIndex ?? 0) || (a.index ?? 0) - (b.index ?? 0));
  const at = all.findIndex((m) => m.ratingKey === ep.ratingKey);
  if (at < 0) return { after: [] };
  return { previous: all[at - 1], after: all.slice(at + 1) };
}

function episode(m: Metadata): Episode {
  return {
    ratingKey: m.ratingKey,
    title: m.title,
    subtitle: episodeLabel(m),
    thumb: m.thumb,
    durationMs: m.duration,
    watched: (m.viewCount ?? 0) > 0,
  };
}

/**
 * The episode to play next in a show or season: one part way through, else
 * the one after the last watched, else the first. Same rule as the Rust side.
 */
function upNext(episodes: Metadata[]): Metadata | undefined {
  const specials = episodes.every((m) => m.parentIndex === 0);
  const list = episodes
    .filter((m) => specials || m.parentIndex !== 0)
    .sort((a, b) => (a.parentIndex ?? 0) - (b.parentIndex ?? 0) || (a.index ?? 0) - (b.index ?? 0));
  const watched = (m: Metadata) => (m.viewCount ?? 0) > 0;
  const started = (m: Metadata) => (m.viewOffset ?? 0) > 0;
  let last = -1;
  list.forEach((m, i) => {
    if (watched(m) || started(m)) last = i;
  });
  if (last < 0) return list[0];
  if (started(list[last])) return list[last];
  return list.slice(last + 1).find((m) => !watched(m));
}

function episodeLabel(m: Metadata) {
  return `${m.grandparentTitle ?? ""} · S${m.parentIndex ?? 0} · E${m.index ?? 0}`;
}

// ---------------------------------------------------------------------------
// Playback

export interface WebPlaybackInfo extends PlaybackInfo {
  partId: number;
  audioStreams: RawStream[];
  subtitleStreams: RawStream[];
}

export interface TranscodeOptions {
  maxBitrateKbps: number;
  resolution: string;
  session: string;
}

/**
 * Plex's HLS transcoder, asked for what every desktop browser plays: H.264
 * and AAC. Files that already are H.264 are only repackaged, not re-encoded.
 * Subtitles are burned into the picture, so every format works.
 */
export function transcodeUrl(ratingKey: string, opts: TranscodeOptions) {
  const server = currentServer();
  const profile =
    "add-transcode-target(type=videoProfile&context=streaming&protocol=hls&container=mpegts&videoCodec=h264&audioCodec=aac,mp3)";
  return buildUrl(
    server.uri,
    "/video/:/transcode/universal/start.m3u8",
    {
      path: `/library/metadata/${ratingKey}`,
      mediaIndex: 0,
      partIndex: 0,
      protocol: "hls",
      fastSeek: 1,
      directPlay: 0,
      directStream: 1,
      directStreamAudio: 1,
      hasMDE: 1,
      location: server.local ? "lan" : "wan",
      offset: 0,
      videoQuality: 100,
      maxVideoBitrate: opts.maxBitrateKbps,
      videoResolution: opts.resolution,
      subtitles: "burn",
      subtitleSize: 100,
      session: opts.session,
      "X-Plex-Session-Identifier": opts.session,
      "X-Plex-Client-Profile-Extra": profile,
    },
    server.token,
  );
}

/** Picks the audio and subtitle tracks Plex uses for this file. 0 turns subtitles off. */
export async function selectStreams(partId: number, streams: { audioStreamID?: number; subtitleStreamID?: number }) {
  const server = currentServer();
  await request(buildUrl(server.uri, `/library/parts/${partId}`, { ...streams, allParts: 1 }, server.token), {
    method: "PUT",
    json: false,
  });
}

/** Timeline URL, also used from `pagehide` with keepalive. */
export function timelineUrl(ratingKey: string, state: string, timeMs: number, durationMs: number, session?: string) {
  const server = currentServer();
  return buildUrl(
    server.uri,
    "/:/timeline",
    {
      ratingKey,
      key: `/library/metadata/${ratingKey}`,
      state,
      time: Math.round(timeMs),
      duration: Math.round(durationMs),
      hasMDE: 1,
      "X-Plex-Session-Identifier": session,
    },
    server.token,
  );
}

async function playbackInfo(ratingKey: string): Promise<WebPlaybackInfo> {
  const item = await metadataRaw(ratingKey);
  const part = item.Media?.[0]?.Part?.[0];
  if (!part?.key) throw new Error("This item has no playable file");
  const streams = part.Stream ?? [];
  const m = meta(item);
  const none: Neighbours = { after: [] };
  const around = m.type === "episode" ? await episodeNeighbours(m).catch(() => none) : none;
  const queue = around.after.map(episode);
  return {
    ratingKey: m.ratingKey,
    title: m.title,
    subtitle: m.type === "episode" ? episodeLabel(m) : m.year != null ? String(m.year) : null,
    durationMs: m.duration ?? 0,
    viewOffsetMs: m.viewOffset ?? 0,
    url: "",
    externalSubtitles: [],
    markers: item.Marker ?? [],
    mpvPath: "",
    logPath: "",
    stripDolbyVision: false,
    next: queue[0] ?? null,
    previous: around.previous ? episode(around.previous) : null,
    queue,
    // Seek previews, chapters and remembered tracks are desktop-only for now.
    hasPreviews: false,
    chapters: [],
    trackKey: m.grandparentRatingKey ?? m.ratingKey,
    rememberedTracks: null,
    partId: part.id,
    audioStreams: streams.filter((s) => s.streamType === 2),
    subtitleStreams: streams.filter((s) => s.streamType === 3),
  };
}

export const getPlaybackInfo = playbackInfo;

// ---------------------------------------------------------------------------
// Commands, by the names `invoke` uses

type Args = Record<string, unknown>;

/** The last bitrate-filtered library, paged through locally. */
let bitrateCache: { key: string; items: Metadata[] } | null = null;
type Command = (args: Args) => Promise<unknown>;

const commands: Record<string, Command> = {
  async get_session(): Promise<Session> {
    const s = stored();
    return { user: s.token ? (s.user ?? null) : null, server: s.server ?? null };
  },

  async auth_start(): Promise<AuthStart> {
    const pin = await request<Pin>(buildUrl(PLEX_TV, "/api/v2/pins", { strong: "true" }), { method: "POST" });
    const q = new URLSearchParams({
      clientID: clientId(),
      code: pin.code,
      "context[device][product]": "PlexRust",
    });
    return { pinId: pin.id, code: pin.code, url: `https://app.plex.tv/auth#?${q}` };
  },

  async auth_wait({ pinId }): Promise<User> {
    const deadline = Date.now() + 10 * 60_000;
    for (;;) {
      const pin = await request<Pin>(buildUrl(PLEX_TV, `/api/v2/pins/${pinId}`));
      if (pin.authToken) {
        const user = await request<User>(buildUrl(PLEX_TV, "/api/v2/user", {}, pin.authToken));
        store({ token: pin.authToken, user });
        return user;
      }
      if (Date.now() > deadline) throw new Error("The sign-in code expired. Try again.");
      await new Promise((r) => setTimeout(r, 1000));
    }
  },

  async sign_out() {
    store({ token: null, user: null, server: null });
  },

  async list_servers(): Promise<ServerSummary[]> {
    return (await servers()).map((r) => ({
      machineId: r.clientIdentifier,
      name: r.name,
      owned: !!r.owned,
      online: !!r.presence,
      version: r.productVersion ?? "",
      platform: r.platform ?? null,
    }));
  },

  async select_server({ machineId }): Promise<ServerConnection> {
    const server = (await servers()).find((r) => r.clientIdentifier === machineId);
    if (!server) throw new Error("That server is no longer on your account");
    const conn = await connect(server);
    store({ server: conn });
    return conn;
  },

  async library_sections(): Promise<LibrarySection[]> {
    return (await container("/library/sections")).Directory ?? [];
  },

  async home_hubs(): Promise<Hub[]> {
    return hubs(await container("/hubs", { count: 20, includeLibraryPlaylists: 0 }));
  },

  async section_items({ section, start, size, sort, filters }): Promise<Page> {
    const f = (filters ?? {}) as Filters;
    const params: Params = { sort: sort as string };
    if (f.genre) params.genre = f.genre;
    if (f.decade) params.decade = f.decade;
    if (f.resolution) params.resolution = f.resolution;
    if (f.unwatched) params.unwatched = 1;
    const [from, count] = [start as number, size as number];
    // Plex can't filter on bitrate: fetch the matching library and page here.
    if (f.minBitrateKbps) {
      const min = f.minBitrateKbps;
      const key = JSON.stringify([section, sort, f]);
      if (bitrateCache?.key !== key) {
        const all = ((await container(`/library/sections/${section}/all`, params)).Metadata ?? [])
          .map(meta)
          .filter((m) => m.Media.some((media) => (media.bitrate ?? 0) >= min));
        bitrateCache = { key, items: all };
      }
      return { items: bitrateCache.items.slice(from, from + count), total: bitrateCache.items.length };
    }
    const c = await container(`/library/sections/${section}/all`, {
      ...params,
      "X-Plex-Container-Start": from,
      "X-Plex-Container-Size": count,
    });
    const items = (c.Metadata ?? []).map(meta);
    return { items, total: c.totalSize ?? c.size ?? items.length };
  },

  async filter_values({ section, field }): Promise<FilterValue[]> {
    if (field !== "genre" && field !== "decade") throw new Error(`unknown filter ${field}`);
    const c = await container(`/library/sections/${section}/${field}`);
    return (c.Directory ?? []).map((d) => ({ key: d.key, title: d.title }));
  },

  async collections({ section }): Promise<Metadata[]> {
    return ((await container(`/library/sections/${section}/collections`)).Metadata ?? []).map(meta);
  },

  async collection_items({ ratingKey }): Promise<Metadata[]> {
    return ((await container(`/library/collections/${ratingKey}/children`)).Metadata ?? []).map(meta);
  },

  async set_watched({ ratingKey, watched }) {
    const server = currentServer();
    const action = watched ? "/:/scrobble" : "/:/unscrobble";
    await request(
      buildUrl(server.uri, action, { key: ratingKey as string, identifier: "com.plexapp.plugins.library" }, server.token),
      { json: false },
    );
  },

  async remove_from_continue_watching({ ratingKey }) {
    const server = currentServer();
    await request(
      buildUrl(server.uri, "/actions/removeFromContinueWatching", { ratingKey: ratingKey as string }, server.token),
      { method: "PUT", json: false },
    );
  },

  async up_next({ ratingKey }): Promise<Metadata | null> {
    const item = meta(await metadataRaw(ratingKey as string));
    const path =
      item.type === "show" ? `/library/metadata/${item.ratingKey}/allLeaves` : `/library/metadata/${item.ratingKey}/children`;
    if (item.type !== "show" && item.type !== "season") return null;
    return upNext(((await container(path)).Metadata ?? []).map(meta)) ?? null;
  },

  async trailers({ ratingKey }): Promise<Metadata[]> {
    const c = await container(`/library/metadata/${ratingKey}/extras`);
    return (c.Metadata ?? []).map(meta).filter((m) => m.extraType === 1);
  },

  async metadata({ ratingKey }): Promise<Metadata> {
    return meta(await metadataRaw(ratingKey as string));
  },

  children: ({ ratingKey }) => children(ratingKey as string),

  async search({ query }): Promise<Hub[]> {
    return hubs(await container("/hubs/search", { query: query as string, limit: 12 }));
  },

  async get_prefs(): Promise<Prefs> {
    return { ...DEFAULT_PREFS, ...read<Partial<Prefs>>(KEYS.prefs) };
  },

  async set_prefs({ prefs }) {
    write(KEYS.prefs, prefs);
  },

  playback_info: ({ ratingKey }) => playbackInfo(ratingKey as string),

  async transcode_url({ ratingKey, maxBitrateKbps, resolution, session }) {
    return transcodeUrl(ratingKey as string, {
      maxBitrateKbps: maxBitrateKbps as number,
      resolution: resolution as string,
      session: session as string,
    });
  },

  async stop_transcode({ session }) {
    const server = currentServer();
    await request(buildUrl(server.uri, "/video/:/transcode/universal/stop", { session: session as string }, server.token), {
      json: false,
    });
  },

  async report_progress({ ratingKey, playbackState, timeMs, durationMs }) {
    const [key, state, time, duration] = [ratingKey as string, playbackState as string, timeMs as number, durationMs as number];
    await request(timelineUrl(key, state, time, duration), { json: false });
    if (state === "stopped" && duration > 0 && time * 10 >= duration * 9) {
      const server = currentServer();
      await request(
        buildUrl(server.uri, "/:/scrobble", { key, identifier: "com.plexapp.plugins.library" }, server.token),
        { json: false },
      );
    }
  },
};

export async function invokeWeb<T>(cmd: string, args: Args = {}): Promise<T> {
  const run = commands[cmd];
  if (!run) throw new Error(`${cmd} isn't available in the browser version`);
  return (await run(args)) as T;
}

/** Plex's image transcoder, resized to the size shown. The token rides in the URL, as in Plex Web. */
export function webImageUrl(server: ServerConnection, path: string, width: number, height: number) {
  return buildUrl(server.uri, "/photo/:/transcode", { width, height, minSize: 1, upscale: 1, url: path }, server.token);
}
