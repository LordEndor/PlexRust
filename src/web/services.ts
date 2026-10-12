/**
 * The browser build's stand-in for `src-tauri/src/calendar.rs` (Radarr and
 * Sonarr) and `src-tauri/src/requests.rs` (Seerr), mirroring `crates/arr` and
 * `crates/seerr` with fetch. Addresses and API keys are kept in localStorage.
 *
 * These servers usually run on plain HTTP at home. Chrome and Edge let an
 * HTTPS page reach a private address over HTTP once the local network prompt
 * is allowed. Radarr and Sonarr answer cross-site calls to their API; Seerr
 * doesn't, so it needs a proxy in front that adds CORS headers
 * (see docs/seerr-in-browser.md).
 */
import type { ArrConfig, ArrKind, ArrStatus, Calendar, MovieRelease, Release } from "@/lib/calendar";
import type { Browse, MediaType, SeerrConfig, SeerrInfo } from "@/lib/seerr";

const TIMEOUT_MS = 20_000;
const KEYS = { arr: "plexrust.arr", seerr: "plexrust.seerr" };

interface Saved {
  url: string;
  apiKey: string;
}

const EMPTY: Saved = { url: "", apiKey: "" };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows can refuse storage; the setting lasts until reload.
  }
}

/** Adds `http://` when missing and drops a trailing `/` and the API path. A URL base such as `/radarr` is kept. */
export function normalizeUrl(input: string, apiSuffixes: string[]): string {
  let url = input.trim().replace(/\/+$/, "");
  if (!url) throw new Error(`"${input}" isn't a valid address`);
  if (!url.includes("://")) url = `http://${url}`;
  for (const suffix of apiSuffixes) if (url.endsWith(suffix)) url = url.slice(0, -suffix.length);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`"${input}" isn't a valid address`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) throw new Error(`"${input}" isn't a valid address`);
  return url.replace(/\/+$/, "");
}

/**
 * Chrome works out on its own that a private IP or a `.local` name is on the
 * home network. Other home names (`nas`, `nas.lan`) have to be marked, or the
 * request is blocked as mixed content. Marking a public name would fail it.
 */
function addressSpace(url: string): RequestInit {
  const host = new URL(url).hostname.toLowerCase();
  const homeName = /^[a-z0-9-]+$/.test(host) || /\.(lan|home|home\.arpa|internal|localdomain)$/.test(host);
  return homeName && host !== "localhost" ? ({ targetAddressSpace: "local" } as RequestInit) : {};
}

class Unreachable extends Error {}

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...addressSpace(url), ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const host = new URL(url).host;
    if (e instanceof DOMException && e.name === "TimeoutError") throw new Unreachable(`${host} didn't answer in time`);
    throw new Unreachable(host);
  }
}

/** Whether anything answers at `url`, even if the browser won't let the page read it. */
async function answers(url: string) {
  try {
    await fetch(url, { ...addressSpace(url), mode: "no-cors", signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return false;
  }
}

function mixedContentHint(url: string) {
  return location.protocol === "https:" && url.startsWith("http:")
    ? " In Chrome or Edge, allow the prompt to access devices on your local network (or turn it on in the site settings next to the address bar). Other browsers block it."
    : "";
}

function errorMessage(body: string) {
  try {
    const v = JSON.parse(body);
    const m = v?.message ?? v?.error;
    if (typeof m === "string") return m;
  } catch {
    // not JSON
  }
  return body.slice(0, 200);
}

// ---------------------------------------------------------------------------
// Radarr and Sonarr

const NAMES: Record<ArrKind, string> = { radarr: "Radarr", sonarr: "Sonarr" };

function arrSaved(): Record<ArrKind, Saved> {
  return read(KEYS.arr, { radarr: EMPTY, sonarr: EMPTY });
}

type Json = Record<string, any>;

/**
 * The key rides in the query rather than an `X-Api-Key` header, so GETs stay
 * "simple" requests and skip the CORS preflight.
 */
async function arrGet(kind: ArrKind, s: Saved, path: string, query: Record<string, string> = {}): Promise<unknown> {
  const name = NAMES[kind];
  const url = new URL(`${s.url}/api/v3${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", s.apiKey);
  let resp: Response;
  try {
    resp = await call(url.toString(), { headers: { Accept: "application/json" } });
  } catch (e) {
    if (e instanceof Unreachable && e.message.endsWith("in time")) throw new Error(e.message);
    throw new Error(`Couldn't reach ${name} at ${new URL(s.url).host}.${mixedContentHint(s.url)}`);
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new Error(`${name} didn't accept the API key. Copy it from ${name} under Settings, General.`);
  }
  const text = await resp.text();
  if (!resp.ok) throw new Error(`${name} rejected the request (${resp.status}): ${errorMessage(text)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${name} sent something unexpected. Check the address.`);
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && v > 0 ? v : null;
}

/** `2026-10-20T00:00:00Z` → `2026-10-20`. */
function day(v: unknown): string | null {
  return typeof v === "string" && v[4] === "-" ? v.slice(0, 10) : null;
}

/** The internet address of an image; the local `/MediaCover` copies need the API key. */
function image(images: unknown, coverType: string): string | null {
  if (!Array.isArray(images)) return null;
  const url = str(images.find((i: Json) => i?.coverType === coverType)?.remoteUrl);
  return url?.startsWith("http") ? url : null;
}

const MOVIE_DATES: [string, MovieRelease][] = [
  ["inCinemas", "cinema"],
  ["digitalRelease", "digital"],
  ["physicalRelease", "physical"],
];

export function movieReleases(m: Json, start: string, end: string): Release[] {
  return MOVIE_DATES.flatMap(([field, movieRelease]) => {
    const date = day(m[field]);
    if (!date || date < start || date > end) return [];
    return [
      {
        id: `radarr-${m.id ?? 0}-${movieRelease}`,
        kind: "movie" as const,
        title: str(m.title) ?? "",
        year: num(m.year),
        date,
        airDateUtc: null,
        movieRelease,
        hasFile: m.hasFile === true,
        monitored: m.monitored !== false,
        overview: str(m.overview),
        runtime: num(m.runtime),
        network: str(m.studio),
        poster: image(m.images, "poster"),
        fanart: image(m.images, "fanart"),
        tmdbId: typeof m.tmdbId === "number" ? m.tmdbId : null,
        tvdbId: null,
      },
    ];
  });
}

export function episodeRelease(e: Json): Release | null {
  const series: Json = e.series ?? {};
  const airDateUtc = str(e.airDateUtc);
  const date = str(e.airDate) ?? day(airDateUtc);
  if (!date) return null;
  const title = str(e.title);
  return {
    id: `sonarr-${e.id ?? 0}`,
    kind: "episode",
    title: str(series.title) ?? "",
    year: num(series.year),
    date,
    airDateUtc,
    movieRelease: null,
    seasonNumber: typeof e.seasonNumber === "number" ? e.seasonNumber : null,
    episodeNumber: typeof e.episodeNumber === "number" ? e.episodeNumber : null,
    episodeTitle: title === "TBA" ? null : title,
    hasFile: e.hasFile === true,
    monitored: e.monitored !== false,
    overview: str(e.overview),
    runtime: num(e.runtime) ?? num(series.runtime),
    network: str(series.network),
    poster: image(series.images, "poster"),
    fanart: image(series.images, "fanart"),
    tmdbId: num(series.tmdbId),
    tvdbId: num(series.tvdbId),
  };
}

async function arrCalendar(kind: ArrKind, s: Saved, start: string, end: string): Promise<Release[]> {
  const query: Record<string, string> = { start, end, unmonitored: "false" };
  if (kind === "sonarr") query.includeSeries = "true";
  const items = await arrGet(kind, s, "/calendar", query);
  if (!Array.isArray(items)) throw new Error(`${NAMES[kind]} sent something unexpected. Check the address.`);
  return kind === "radarr"
    ? items.flatMap((m: Json) => movieReleases(m, start, end))
    : items.map(episodeRelease).filter((r): r is Release => r !== null);
}

function cmp(a: string | number | null | undefined, b: string | number | null | undefined) {
  return (a ?? "") < (b ?? "") ? -1 : (a ?? "") > (b ?? "") ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Seerr

const DISCOVER_PATHS: Record<string, string> = {
  trending: "/discover/trending",
  movies: "/discover/movies",
  tv: "/discover/tv",
  upcomingMovies: "/discover/movies/upcoming",
  upcomingTv: "/discover/tv/upcoming",
};

const SEERR_PROXY_HELP =
  "Seerr doesn't let web pages on other sites call it, so the browser version needs a small proxy in front of it that allows this. See docs/seerr-in-browser.md in the PlexRust repository, or use the desktop app.";

function seerrSaved(): Saved {
  return read(KEYS.seerr, EMPTY);
}

let seerrInfo: { key: string; info: SeerrInfo } | null = null;

/** Percent-encodes everything but unreserved characters; Seerr rejects raw `!'()*`. */
function encode(s: string) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function seerrSend(s: Saved, method: string, path: string, query: Record<string, string | number> = {}, body?: unknown) {
  if (!s.apiKey) {
    throw new Error("In the browser, Seerr needs its API key (Seerr, Settings, General). Signing in with Plex only works in the desktop app.");
  }
  const qs = Object.entries(query)
    .map(([k, v]) => `${k}=${encode(String(v))}`)
    .join("&");
  const url = `${s.url}/api/v1${path}${qs ? `?${qs}` : ""}`;
  const headers: Record<string, string> = { Accept: "application/json", "X-Api-Key": s.apiKey };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let resp: Response;
  try {
    resp = await call(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    if (e instanceof Unreachable && e.message.endsWith("in time")) throw new Error(e.message);
    const host = new URL(s.url).host;
    if (await answers(`${s.url}/api/v1/status`)) throw new Error(`${host} answers, but the browser blocked the call. ${SEERR_PROXY_HELP}`);
    throw new Error(`Couldn't reach Seerr at ${host}.${mixedContentHint(s.url)}`);
  }
  const text = await resp.text();
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) throw new Error("Seerr didn't accept the API key. Copy it from Seerr under Settings, General.");
    throw new Error(`Seerr rejected the request (${resp.status}): ${errorMessage(text)}`);
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Seerr sent something unexpected. Check the address.");
  }
}

function userName(u: Json) {
  return [u.displayName, u.username, u.plexUsername, u.email].find((n) => typeof n === "string" && n) ?? `User ${u.id}`;
}

const has4k = (services: unknown) => Array.isArray(services) && services.some((s: Json) => s?.is4k === true);

async function openSeerr(s: Saved): Promise<SeerrInfo> {
  const key = `${s.url}\n${s.apiKey}`;
  if (seerrInfo?.key === key) return seerrInfo.info;
  const status = (await seerrSend(s, "GET", "/status")) as Json;
  const user = (await seerrSend(s, "GET", "/auth/me")) as Json;
  // Listing services needs admin rights; without them, assume no 4K.
  const [radarr, sonarr] = await Promise.all(
    ["/service/radarr", "/service/sonarr"].map((p) => seerrSend(s, "GET", p).catch(() => null)),
  );
  const info: SeerrInfo = {
    version: typeof status?.version === "string" ? status.version : "",
    userName: userName(user),
    user: { id: user.id, permissions: user.permissions ?? 0 },
    movie4k: has4k(radarr),
    tv4k: has4k(sonarr),
  };
  seerrInfo = { key, info };
  return info;
}

async function seerrConnection(): Promise<{ s: Saved; info: SeerrInfo }> {
  const s = seerrSaved();
  if (!s.url) throw new Error("Requests aren't set up. Add your Seerr server in Settings.");
  return { s, info: await openSeerr(s) };
}

/** Copies the title, year and poster of `details` onto a request. */
function addSummary(request: Json, details: Json) {
  const date: string | undefined = details.releaseDate ?? details.firstAirDate;
  request.title = details.title ?? details.name ?? null;
  request.year = date ? date.slice(0, 4) : null;
  request.posterPath = details.posterPath ?? null;
}

// ---------------------------------------------------------------------------
// Commands, by the names `invoke` uses

type Args = Record<string, unknown>;

export const serviceCommands: Record<string, (args: Args) => Promise<unknown>> = {
  async arr_config(): Promise<ArrConfig> {
    const s = arrSaved();
    return {
      radarr: { url: s.radarr.url, hasApiKey: s.radarr.apiKey !== "" },
      sonarr: { url: s.sonarr.url, hasApiKey: s.sonarr.apiKey !== "" },
    };
  },

  /** Saves the server once it answers. An empty `apiKey` keeps the saved one. */
  async arr_connect({ kind, url, apiKey }): Promise<ArrStatus> {
    const k = kind as ArrKind;
    const all = arrSaved();
    const base = normalizeUrl(url as string, ["/api/v3", "/api"]);
    const key = (apiKey as string | null)?.trim() || all[k].apiKey;
    if (!key) throw new Error(`Enter the API key from ${NAMES[k]} under Settings, General.`);
    const v = (await arrGet(k, { url: base, apiKey: key }, "/system/status")) as Json;
    const status: ArrStatus = { appName: str(v?.appName) ?? "", version: str(v?.version) ?? "" };
    const other = k === "radarr" ? "sonarr" : "radarr";
    if (status.appName.toLowerCase() === other) throw new Error(`that address is ${status.appName}, not ${NAMES[k]}`);
    write(KEYS.arr, { ...all, [k]: { url: base, apiKey: key } });
    return status;
  },

  async arr_disconnect({ kind }) {
    write(KEYS.arr, { ...arrSaved(), [kind as ArrKind]: EMPTY });
  },

  /** Releases from every server that answered, plus what went wrong with the others. */
  async arr_calendar({ start, end }): Promise<Calendar> {
    const s = arrSaved();
    const kinds = (["radarr", "sonarr"] as const).filter((k) => s[k].url);
    const results = await Promise.allSettled(kinds.map((k) => arrCalendar(k, s[k], start as string, end as string)));
    const calendar: Calendar = { releases: [], errors: [] };
    results.forEach((r, i) => {
      if (r.status === "fulfilled") calendar.releases.push(...r.value);
      else calendar.errors.push({ source: kinds[i], message: r.reason instanceof Error ? r.reason.message : String(r.reason) });
    });
    calendar.releases.sort(
      (a, b) =>
        cmp(a.date, b.date) || cmp(a.airDateUtc, b.airDateUtc) || cmp(a.title, b.title) || cmp(a.episodeNumber, b.episodeNumber),
    );
    return calendar;
  },

  async seerr_config(): Promise<SeerrConfig> {
    const s = seerrSaved();
    return { url: s.url, hasApiKey: s.apiKey !== "" };
  },

  /** Saves the server once it answers. An empty `apiKey` keeps the saved one; `clearApiKey` drops it. */
  async seerr_connect({ url, apiKey, clearApiKey }): Promise<SeerrInfo> {
    const base = normalizeUrl(url as string, ["/api/v1"]);
    const saved = seerrSaved();
    const key = (apiKey as string | null)?.trim() || (clearApiKey ? "" : saved.apiKey);
    const info = await openSeerr({ url: base, apiKey: key });
    write(KEYS.seerr, { url: base, apiKey: key });
    return info;
  },

  async seerr_disconnect() {
    seerrInfo = null;
    write(KEYS.seerr, EMPTY);
  },

  async seerr_info() {
    return (await seerrConnection()).info;
  },

  async seerr_search({ query, page }) {
    const { s } = await seerrConnection();
    return seerrSend(s, "GET", "/search", { query: query as string, page: (page as number) ?? 1 });
  },

  async seerr_discover({ row, page }) {
    const { s } = await seerrConnection();
    const path = DISCOVER_PATHS[row as string];
    if (!path) throw new Error(`unknown discover row ${row}`);
    return seerrSend(s, "GET", path, { page: (page as number) ?? 1 });
  },

  /** Mirrors `Browse::query` in `crates/seerr`. */
  async seerr_browse({ mediaType, page, browse }) {
    const { s } = await seerrConnection();
    const movie = (mediaType as MediaType) === "movie";
    const b = (browse ?? {}) as Browse;
    const query: Record<string, string | number> = { page: (page as number) ?? 1 };
    if (b.sortBy) query.sortBy = b.sortBy;
    if (b.genre != null) query.genre = b.genre;
    if (b.dateFrom) query[movie ? "primaryReleaseDateGte" : "firstAirDateGte"] = b.dateFrom;
    if (b.dateTo) query[movie ? "primaryReleaseDateLte" : "firstAirDateLte"] = b.dateTo;
    if (b.minRating) query.voteAverageGte = b.minRating;
    if (b.minVotes) query.voteCountGte = b.minVotes;
    return seerrSend(s, "GET", movie ? "/discover/movies" : "/discover/tv", query);
  },

  async seerr_genres({ mediaType }) {
    const { s } = await seerrConnection();
    return seerrSend(s, "GET", `/genres/${mediaType as MediaType}`);
  },

  async seerr_details({ mediaType, tmdbId }) {
    const { s } = await seerrConnection();
    return seerrSend(s, "GET", `/${mediaType as MediaType}/${tmdbId}`);
  },

  async seerr_quota() {
    const { s, info } = await seerrConnection();
    return seerrSend(s, "GET", `/user/${info.user.id}/quota`);
  },

  async seerr_request({ request }) {
    const { s } = await seerrConnection();
    const r = request as { mediaType: MediaType; tmdbId: number; seasons?: number[]; is4k?: boolean };
    const body: Json = { mediaType: r.mediaType, mediaId: r.tmdbId, is4k: r.is4k ?? false };
    if (r.mediaType === "tv") body.seasons = r.seasons?.length ? r.seasons : "all";
    return seerrSend(s, "POST", "/request", {}, body);
  },

  /** The user's latest requests, newest first, with the title, year and poster added on. */
  async seerr_requests() {
    const { s, info } = await seerrConnection();
    const page = (await seerrSend(s, "GET", "/request", {
      take: 50,
      skip: 0,
      sort: "added",
      requestedBy: info.user.id,
    })) as Json;
    const requests: Json[] = Array.isArray(page?.results) ? page.results : [];
    await Promise.all(
      requests.map(async (r) => {
        const media: Json = r.media ?? {};
        if (typeof media.tmdbId !== "number") return;
        const details = await seerrSend(s, "GET", `/${media.mediaType === "tv" ? "tv" : "movie"}/${media.tmdbId}`).catch(() => null);
        if (details) addSummary(r, details as Json);
      }),
    );
    return requests;
  },

  async seerr_cancel({ requestId }) {
    const { s } = await seerrConnection();
    await seerrSend(s, "DELETE", `/request/${requestId}`);
  },
};
