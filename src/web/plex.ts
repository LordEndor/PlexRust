/**
 * The browser build's stand-in for the Rust side: the same commands as
 * `src-tauri/src/commands.rs`, talking to plex.tv and the Plex server
 * straight from the page. Everything is kept in localStorage.
 *
 * Plex's identification headers and the token travel as query parameters, so
 * plain GETs stay "simple" requests and skip the CORS preflight.
 */
import type { AuthStart, Hub, LibrarySection, Metadata, Page, ServerConnection, ServerSummary, Session, User } from "@/lib/api";
import type { Marker, PlaybackInfo } from "@/lib/player";
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
  Metadata?: (Metadata & RawExtras)[];
  Hub?: (Hub & { Metadata?: Metadata[] })[];
  Directory?: LibrarySection[];
}

/** Fields the UI types don't carry but playback needs. */
interface RawExtras {
  Marker?: Marker[];
  Media: (Metadata["Media"][number] & { Part?: RawPart[] })[];
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

function firstAfter(items: Metadata[], after: number) {
  return items
    .filter((m) => m.index != null && m.index > after)
    .sort((a, b) => a.index! - b.index!)[0];
}

async function nextEpisode(ep: Metadata): Promise<Metadata | undefined> {
  if (!ep.parentRatingKey || ep.index == null) return;
  const next = firstAfter(await children(ep.parentRatingKey), ep.index);
  if (next) return next;
  if (!ep.grandparentRatingKey || ep.parentIndex == null) return;
  const season = firstAfter(await children(ep.grandparentRatingKey), ep.parentIndex);
  if (!season) return;
  return firstAfter(await children(season.ratingKey), -Infinity);
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
  const next = m.type === "episode" ? await nextEpisode(m).catch(() => undefined) : undefined;
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
    next: next ? { ratingKey: next.ratingKey, title: next.title, subtitle: episodeLabel(next), thumb: next.thumb } : null,
    partId: part.id,
    audioStreams: streams.filter((s) => s.streamType === 2),
    subtitleStreams: streams.filter((s) => s.streamType === 3),
  };
}

export const getPlaybackInfo = playbackInfo;

// ---------------------------------------------------------------------------
// Commands, by the names `invoke` uses

type Args = Record<string, unknown>;
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

  async section_items({ section, start, size, sort }): Promise<Page> {
    const c = await container(`/library/sections/${section}/all`, {
      sort: sort as string,
      "X-Plex-Container-Start": start as number,
      "X-Plex-Container-Size": size as number,
    });
    const items = (c.Metadata ?? []).map(meta);
    return { items, total: c.totalSize ?? c.size ?? items.length };
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
