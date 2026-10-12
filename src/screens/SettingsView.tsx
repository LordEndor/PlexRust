import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { ArrowDown, ArrowUp, Check, ChevronDown, Eye, EyeOff, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage, library, type FilterValue, type Hub, type LibrarySection } from "@/lib/api";
import { customHubId, newRowId, presets, type CustomRow } from "@/lib/customRows";
import { QUALITIES } from "@/lib/player";
import {
  ACCENTS,
  arrangeHubs,
  LANGUAGES,
  POSTER_SIZES,
  savePrefs,
  usePrefs,
  type Prefs,
  type SkipMode,
} from "@/lib/prefs";
import { arr, ARR_NAMES, notifyArrConfigChanged, type ArrKind, type ArrStatus } from "@/lib/calendar";
import { notifySeerrConfigChanged, seerr, type SeerrInfo } from "@/lib/seerr";
import { cn } from "@/lib/utils";
import { SORTS } from "@/screens/LibraryView";

/** The GitHub Pages build, which reaches servers at home from the page itself. */
const IS_WEB = import.meta.env.MODE === "web";

const SKIP_OPTIONS: { value: SkipMode; label: string }[] = [
  { value: "auto", label: "Automatically" },
  { value: "button", label: "Show button" },
  { value: "off", label: "Off" },
];

export function SettingsView() {
  const prefs = usePrefs();
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-8 py-8">
        <h1 className="text-2xl font-semibold">Settings</h1>

        {!prefs ? (
          <Skeleton className="h-64" />
        ) : (
          <>
            <Section
              title="Skipping"
              description="Intros and credits use the markers Plex detects. Recaps, outros and unmarked intros are found by chapter name, such as Recap, Opening or ED. Automatically fills the skip button for 5 seconds first, so you can see it coming."
            >
              <Row label="Skip recaps" hint={'The "Previously on" part at the start of an episode.'}>
                <Segmented value={prefs.skipRecap} options={SKIP_OPTIONS} onChange={(v) => savePrefs({ skipRecap: v })} />
              </Row>
              <Row label="Skip intros" hint="Automatically jumps past the intro. Show button lets you choose each time.">
                <Segmented value={prefs.skipIntro} options={SKIP_OPTIONS} onChange={(v) => savePrefs({ skipIntro: v })} />
              </Row>
              <Row
                label="Skip credits"
                hint="When the ending credits start, episodes move on to the next one and movies finish. Automatically gives you 10 seconds to cancel."
              >
                <Segmented value={prefs.skipCredits} options={SKIP_OPTIONS} onChange={(v) => savePrefs({ skipCredits: v })} />
              </Row>
              <Row label="Skip outros" hint="The ending song. At the end of an episode it brings up Up Next, like the credits.">
                <Segmented value={prefs.skipOutro} options={SKIP_OPTIONS} onChange={(v) => savePrefs({ skipOutro: v })} />
              </Row>
            </Section>

            <Section title="Playback">
              <Row label="Default quality" hint="Original plays the file as is, including 4K HDR. Lower qualities ask Plex to transcode.">
                <Picker
                  value={prefs.quality}
                  options={QUALITIES.map((q) => ({ value: q.label, label: q.label }))}
                  onChange={(v) => savePrefs({ quality: v })}
                />
              </Row>
              <Row label="Audio language" hint="Picked when a file has it, otherwise the file's default track plays.">
                <Picker
                  value={prefs.audioLanguage}
                  options={[{ value: "", label: "File default" }, ...LANGUAGES]}
                  onChange={(v) => savePrefs({ audioLanguage: v })}
                />
              </Row>
              <Row label="Subtitle language" hint="Turned on when a file has it. You can always change it while watching.">
                <Picker
                  value={prefs.subtitleLanguage}
                  options={[{ value: "", label: "File default" }, { value: "off", label: "Off" }, ...LANGUAGES]}
                  onChange={(v) => savePrefs({ subtitleLanguage: v })}
                />
              </Row>
            </Section>

            <Section title="Appearance">
              <Row label="Accent color" hint="Used for buttons, progress bars and highlights.">
                <div className="flex gap-2">
                  {ACCENTS.map((a) => (
                    <button
                      key={a.key}
                      title={a.label}
                      aria-label={a.label}
                      onClick={() => savePrefs({ accent: a.key })}
                      className={cn(
                        "ring-offset-card grid size-7 place-items-center rounded-full ring-offset-2 transition-transform hover:scale-110",
                        prefs.accent === a.key && "ring-2 ring-white/80",
                      )}
                      style={{ background: a.color }}
                    >
                      {prefs.accent === a.key && <Check className="size-4 text-black/80" />}
                    </button>
                  ))}
                </div>
              </Row>
              <Row label="Poster size" hint="For Home rows, libraries and seasons.">
                <Segmented
                  value={prefs.posterSize}
                  options={POSTER_SIZES.map((s) => ({ value: s.key, label: s.label }))}
                  onChange={(v) => savePrefs({ posterSize: v })}
                />
              </Row>
            </Section>

            <Section title="Home" description="Pick which rows Home shows, and in what order.">
              <Row label="Featured banner" hint="Recently added movies and shows, rotating at the top of Home.">
                <Segmented
                  value={prefs.showFeatured ? "on" : "off"}
                  options={[
                    { value: "on", label: "On" },
                    { value: "off", label: "Off" },
                  ]}
                  onChange={(v) => savePrefs({ showFeatured: v === "on" })}
                />
              </Row>
              <HomeRows prefs={prefs} />
            </Section>
          </>
        )}

        <Section
          title="Requests"
          description={
            IS_WEB
              ? "Connect your Seerr, Overseerr or Jellyseerr server to find and request movies and shows from Discover. In the browser, Seerr has to be reached through a proxy that allows web pages to call it (see docs/seerr-in-browser.md in the PlexRust repository)."
              : "Connect your Seerr, Overseerr or Jellyseerr server to find and request movies and shows from Discover."
          }
        >
          <SeerrSettings />
        </Section>

        <Section
          title="Calendar"
          description={
            IS_WEB
              ? "Connect Radarr and Sonarr to see upcoming movies and episodes in Calendar. Either one is enough. Chrome or Edge will ask to access devices on your local network; allow it."
              : "Connect Radarr and Sonarr to see upcoming movies and episodes in Calendar. Either one is enough."
          }
        >
          <ArrSettings kind="radarr" port={7878} />
          <ArrSettings kind="sonarr" port={8989} />
        </Section>

        <Section title="About">
          <Row label="PlexRust" hint="New versions are also checked for every time the app starts.">
            <span className="text-muted-foreground text-sm tabular-nums">{version && `v${version}`}</span>
          </Row>
          <UpdateRow />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
      </div>
      <div className="bg-card divide-y rounded-xl border">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-muted-foreground mt-0.5 text-sm">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Picker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="min-w-44 justify-between">
          {current.label}
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 min-w-44 overflow-y-auto">
        {options.map((o) => (
          <DropdownMenuCheckItem key={o.value} checked={o.value === current.value} onSelect={() => onChange(o.value)}>
            {o.label}
          </DropdownMenuCheckItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Home rows with show/hide and move up/down, plus the custom rows made here.
 * Plex's rows come from the server, so they match what Home shows.
 */
function HomeRows({ prefs }: { prefs: Prefs }) {
  const [hubs, setHubs] = useState<Hub[] | null>(null);
  const [sections, setSections] = useState<LibrarySection[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The row being edited, or "new".
  const [editing, setEditing] = useState<CustomRow | "new" | null>(null);
  useEffect(() => {
    library
      .homeHubs()
      .then(setHubs)
      .catch((e) => setError(errorMessage(e)));
    api.librarySections().then(setSections, () => setSections([]));
  }, []);

  if (error) return <div className="text-destructive px-5 py-4 text-sm">Couldn't load the Home rows: {error}</div>;
  if (!hubs) return <Skeleton className="m-5 h-24" />;

  const custom: Hub[] = prefs.customRows.map((r) => ({
    hubIdentifier: customHubId(r),
    title: r.title,
    type: "",
    Metadata: [],
  }));
  const rows = arrangeHubs([...hubs, ...custom], prefs, true);
  const ids = rows.map((h) => h.hubIdentifier);
  const customRow = (id: string) => prefs.customRows.find((r) => customHubId(r) === id);

  function move(i: number, by: -1 | 1) {
    const order = ids.slice();
    [order[i], order[i + by]] = [order[i + by], order[i]];
    // Keep rows that aren't on this server right now where they were.
    savePrefs({ hubOrder: [...order, ...prefs.hubOrder.filter((id) => !order.includes(id))] });
  }

  function toggle(id: string) {
    const hidden = prefs.hiddenHubs.includes(id);
    savePrefs({ hiddenHubs: hidden ? prefs.hiddenHubs.filter((h) => h !== id) : [...prefs.hiddenHubs, id] });
  }

  function save(row: CustomRow) {
    const exists = prefs.customRows.some((r) => r.id === row.id);
    savePrefs({
      customRows: exists ? prefs.customRows.map((r) => (r.id === row.id ? row : r)) : [...prefs.customRows, row],
      // A new row goes last, even when the order was picked before.
      hubOrder: exists || prefs.hubOrder.length === 0 ? prefs.hubOrder : [...ids, customHubId(row)],
    });
    setEditing(null);
  }

  function remove(row: CustomRow) {
    const id = customHubId(row);
    savePrefs({
      customRows: prefs.customRows.filter((r) => r.id !== row.id),
      hubOrder: prefs.hubOrder.filter((h) => h !== id),
      hiddenHubs: prefs.hiddenHubs.filter((h) => h !== id),
    });
  }

  const iconButton = "size-8";
  return (
    <>
      {rows.map((h, i) => {
        const hidden = prefs.hiddenHubs.includes(h.hubIdentifier);
        const row = customRow(h.hubIdentifier);
        return (
          <div key={h.hubIdentifier} className="flex items-center gap-2 px-5 py-2.5">
            <span className={cn("flex-1 truncate text-sm", hidden && "text-muted-foreground line-through")}>
              {h.title}
              {row && <span className="text-muted-foreground ml-2 text-xs">Custom</span>}
            </span>
            {row && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className={iconButton}
                  onClick={() => setEditing(row)}
                  aria-label="Edit row"
                  title="Edit row"
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={iconButton}
                  onClick={() => remove(row)}
                  aria-label="Delete row"
                  title="Delete row"
                >
                  <Trash2 />
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              className={iconButton}
              disabled={i === 0}
              onClick={() => move(i, -1)}
              aria-label="Move up"
            >
              <ArrowUp />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={iconButton}
              disabled={i === rows.length - 1}
              onClick={() => move(i, 1)}
              aria-label="Move down"
            >
              <ArrowDown />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={iconButton}
              onClick={() => toggle(h.hubIdentifier)}
              aria-label={hidden ? "Show row" : "Hide row"}
              title={hidden ? "Show row" : "Hide row"}
            >
              {hidden ? <EyeOff className="text-muted-foreground" /> : <Eye />}
            </Button>
          </div>
        );
      })}
      <div className="flex items-center gap-2 px-5 py-2.5">
        <Button variant="outline" size="sm" onClick={() => setEditing("new")} disabled={!sections.length}>
          <Plus />
          Add row
        </Button>
        {(prefs.hubOrder.length > 0 || prefs.hiddenHubs.length > 0) && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => savePrefs({ hubOrder: [], hiddenHubs: [] })}
          >
            Reset to Plex's order
          </Button>
        )}
      </div>
      {editing && (
        <CustomRowDialog
          row={editing === "new" ? null : editing}
          sections={sections.filter((s) => s.type === "movie" || s.type === "show")}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

/** Makes or edits a custom Home row: a library, a sort, and optionally a genre and unwatched only. */
function CustomRowDialog({
  row,
  sections,
  onSave,
  onClose,
}: {
  row: CustomRow | null;
  sections: LibrarySection[];
  onSave: (row: CustomRow) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(row?.title ?? "");
  const [section, setSection] = useState(row?.section ?? sections[0]?.key ?? "");
  const [sortKey, setSortKey] = useState(row?.sort.split(":")[0] ?? "audienceRating");
  const [desc, setDesc] = useState(row ? row.sort.endsWith(":desc") : true);
  const [genre, setGenre] = useState(row?.filters.genre ?? "");
  const [unwatched, setUnwatched] = useState(row?.filters.unwatched ?? false);
  const [genres, setGenres] = useState<FilterValue[]>([]);

  const kind = sections.find((s) => s.key === section)?.type;
  const sorts = SORTS.filter((s) => !s.only || s.only === kind);
  const sort = sorts.find((s) => s.key === sortKey) ?? sorts[0];

  useEffect(() => {
    if (!section) return;
    library.filterValues(section, "genre").then(setGenres, () => setGenres([]));
  }, [section]);

  function pickSection(key: string) {
    if (key === section) return;
    setSection(key);
    // Genres are numbered per library.
    setGenre("");
  }

  function pickSort(key: string) {
    setSortKey(key);
    setDesc(SORTS.find((s) => s.key === key)?.desc ?? true);
  }

  function applyPreset(p: Omit<CustomRow, "id">) {
    setTitle(p.title);
    setSection(p.section);
    const [key, dir] = p.sort.split(":");
    setSortKey(key);
    setDesc(dir === "desc");
    setGenre(p.filters.genre ?? "");
    setUnwatched(p.filters.unwatched ?? false);
  }

  function save() {
    const lib = sections.find((s) => s.key === section);
    onSave({
      id: row?.id ?? newRowId(),
      title: title.trim() || `${sort.label} in ${lib?.title ?? "library"}`,
      section,
      sort: sort.key === "random" ? "random" : `${sort.key}${desc ? ":desc" : ""}`,
      filters: { genre: genre || null, unwatched },
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-5 p-6">
        <div>
          <DialogTitle>{row ? "Edit row" : "Add a Home row"}</DialogTitle>
          <DialogDescription>Shows the first 20 of a library, in the order you pick.</DialogDescription>
        </div>
        {!row && (
          <div className="flex flex-wrap gap-2">
            {presets(sections).map((p) => (
              <Button key={p.title} variant="secondary" size="sm" onClick={() => applyPreset(p)}>
                {p.title}
              </Button>
            ))}
          </div>
        )}
        <div className="bg-card divide-y rounded-xl border">
          <Row label="Name">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`${sort.label} in ${sections.find((s) => s.key === section)?.title ?? "library"}`}
              className={cn(inputClass, "w-56")}
            />
          </Row>
          <Row label="Library">
            <Picker
              value={section}
              options={sections.map((s) => ({ value: s.key, label: s.title }))}
              onChange={pickSection}
            />
          </Row>
          <Row label="Sort by">
            <div className="flex items-center gap-2">
              <Picker
                value={sort.key}
                options={sorts.map((s) => ({ value: s.key, label: s.label }))}
                onChange={pickSort}
              />
              {sort.key !== "random" && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setDesc(!desc)}
                  aria-label={desc ? "Descending" : "Ascending"}
                  title={desc ? "Descending" : "Ascending"}
                >
                  {desc ? <ArrowDown /> : <ArrowUp />}
                </Button>
              )}
            </div>
          </Row>
          <Row label="Genre">
            <Picker
              value={genre}
              options={[{ value: "", label: "Any genre" }, ...genres.map((g) => ({ value: g.key, label: g.title }))]}
              onChange={setGenre}
            />
          </Row>
          <Row label="Unwatched only">
            <Segmented
              value={unwatched ? "on" : "off"}
              options={[
                { value: "on", label: "On" },
                { value: "off", label: "Off" },
              ]}
              onChange={(v) => setUnwatched(v === "on")}
            />
          </Row>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!section}>
            {row ? "Save" : "Add row"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; update: Update }
  | { kind: "installing"; percent: number | null }
  | { kind: "error"; message: string };

function UpdateRow() {
  const [state, setState] = useState<UpdateState>({ kind: "idle" });

  async function checkNow() {
    setState({ kind: "checking" });
    try {
      const update = await check();
      setState(update ? { kind: "available", update } : { kind: "current" });
    } catch (e) {
      setState({ kind: "error", message: errorMessage(e) });
    }
  }

  async function install(update: Update) {
    let total = 0;
    let done = 0;
    setState({ kind: "installing", percent: null });
    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        if (ev.event === "Progress") {
          done += ev.data.chunkLength;
          if (total) setState({ kind: "installing", percent: Math.round((done / total) * 100) });
        }
      });
      await relaunch();
    } catch (e) {
      setState({ kind: "error", message: errorMessage(e) });
    }
  }

  const hint = {
    idle: "See whether a newer version has been released.",
    checking: "Checking GitHub for a newer version…",
    current: "You're on the latest version.",
    available: state.kind === "available" ? `Version ${state.update.version} is available.` : "",
    installing:
      state.kind === "installing" && state.percent != null
        ? `Downloading… ${state.percent}%. The app restarts when it's done.`
        : "Downloading… The app restarts when it's done.",
    error: state.kind === "error" ? `Couldn't check for updates: ${state.message}` : "",
  }[state.kind];

  return (
    <Row label="Updates" hint={hint}>
      {state.kind === "available" ? (
        <Button onClick={() => install(state.update)}>Update and restart</Button>
      ) : (
        <Button variant="outline" onClick={checkNow} disabled={state.kind === "checking" || state.kind === "installing"}>
          {(state.kind === "checking" || state.kind === "installing") && <Loader2 className="animate-spin" />}
          Check for updates
        </Button>
      )}
    </Row>
  );
}

const inputClass =
  "bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-72 rounded-lg border px-3 text-sm outline-none focus-visible:ring-[3px]";

/** Address (and optional API key) of the Seerr server, with a check that it answers. */
function SeerrSettings() {
  const [url, setUrl] = useState("");
  const [savedUrl, setSavedUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [info, setInfo] = useState<SeerrInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    seerr
      .config()
      .then((c) => {
        setUrl(c.url);
        setSavedUrl(c.url);
        setHasKey(c.hasApiKey);
        if (c.url) {
          seerr
            .info()
            .then(setInfo)
            .catch((e) => setError(errorMessage(e)));
        }
      })
      .catch(() => {});
  }, []);

  async function connect(clearKey = false) {
    setBusy(true);
    setError(null);
    try {
      const i = await seerr.connect(url, apiKey.trim() || null, clearKey);
      const c = await seerr.config();
      setInfo(i);
      setUrl(c.url);
      setSavedUrl(c.url);
      setHasKey(c.hasApiKey);
      setApiKey("");
      notifySeerrConfigChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    await seerr.disconnect();
    setInfo(null);
    setUrl("");
    setSavedUrl("");
    setHasKey(false);
    setError(null);
    notifySeerrConfigChanged();
  }

  const status = error
    ? `Couldn't connect: ${error}`
    : info
      ? `Connected as ${info.userName}${info.version ? ` · Seerr ${info.version}` : ""}.`
      : savedUrl
        ? "Connecting…"
        : IS_WEB
          ? "In the browser, Seerr needs its API key as well as the address."
          : "Signs in with your Plex account, so requests are made as you.";

  return (
    <>
      <Row label="Server address" hint={status}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && url.trim() && connect()}
          placeholder="http://192.168.1.10:5055"
          className={inputClass}
          spellCheck={false}
        />
      </Row>
      <Row
        label="API key"
        hint={
          hasKey
            ? "Saved. Requests are made with the API key instead of your Plex account."
            : IS_WEB
              ? "Needed in the browser. Found in Seerr under Settings, General."
              : "Optional. Only needed if signing in with Plex doesn't work. Found in Seerr under Settings, General."
        }
      >
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasKey ? "••••••••" : "Not set"}
          className={inputClass}
          type="password"
          spellCheck={false}
        />
      </Row>
      <div className="flex justify-end gap-2 px-5 py-4">
        {hasKey && (
          <Button variant="ghost" disabled={busy} onClick={() => connect(true)}>
            Remove API key
          </Button>
        )}
        {savedUrl && (
          <Button variant="outline" disabled={busy} onClick={disconnect}>
            Disconnect
          </Button>
        )}
        <Button disabled={busy || !url.trim()} onClick={() => connect()}>
          {busy && <Loader2 className="animate-spin" />}
          {savedUrl && url === savedUrl && !apiKey ? "Test connection" : "Connect"}
        </Button>
      </div>
    </>
  );
}

/** Address and API key of Radarr or Sonarr, checked before saving. */
function ArrSettings({ kind, port }: { kind: ArrKind; port: number }) {
  const name = ARR_NAMES[kind];
  const [url, setUrl] = useState("");
  const [savedUrl, setSavedUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [placeholder, setPlaceholder] = useState(`http://192.168.1.10:${port}`);
  const [status, setStatus] = useState<ArrStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    arr
      .config()
      .then((c) => {
        setUrl(c[kind].url);
        setSavedUrl(c[kind].url);
        setHasKey(c[kind].hasApiKey);
      })
      .catch(() => {});
    // Radarr and Sonarr usually run next to Seerr, so suggest the same machine.
    seerr
      .config()
      .then((c) => {
        const host = c.url && new URL(c.url).hostname;
        if (host) setPlaceholder(`http://${host}:${port}`);
      })
      .catch(() => {});
  }, [kind, port]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const st = await arr.connect(kind, url, apiKey.trim() || null);
      const c = await arr.config();
      setStatus(st);
      setUrl(c[kind].url);
      setSavedUrl(c[kind].url);
      setHasKey(c[kind].hasApiKey);
      setApiKey("");
      notifyArrConfigChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    await arr.disconnect(kind);
    setStatus(null);
    setUrl("");
    setSavedUrl("");
    setHasKey(false);
    setError(null);
    notifyArrConfigChanged();
  }

  const hint = error
    ? `Couldn't connect: ${error}`
    : status
      ? `Connected to ${status.appName || name}${status.version ? ` ${status.version}` : ""}.`
      : savedUrl
        ? "Saved."
        : `Not set up. ${name} usually runs on port ${port}.`;

  return (
    <div className="divide-y">
      <Row label={name} hint={hint}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && url.trim() && connect()}
          placeholder={placeholder}
          className={inputClass}
          spellCheck={false}
          aria-label={`${name} address`}
        />
      </Row>
      <Row
        label="API key"
        hint={hasKey ? "Saved." : `Found in ${name} under Settings, General.`}
      >
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && url.trim() && connect()}
          placeholder={hasKey ? "••••••••" : "Not set"}
          className={inputClass}
          type="password"
          spellCheck={false}
          aria-label={`${name} API key`}
        />
      </Row>
      <div className="flex justify-end gap-2 px-5 py-4">
        {savedUrl && (
          <Button variant="outline" disabled={busy} onClick={disconnect}>
            Disconnect
          </Button>
        )}
        <Button disabled={busy || !url.trim() || (!hasKey && !apiKey.trim())} onClick={connect}>
          {busy && <Loader2 className="animate-spin" />}
          {savedUrl && url === savedUrl && !apiKey ? "Test connection" : "Connect"}
        </Button>
      </div>
    </div>
  );
}
