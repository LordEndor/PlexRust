import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { ChevronDown, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { QUALITIES } from "@/lib/player";
import { LANGUAGES, savePrefs, usePrefs, type SkipMode } from "@/lib/prefs";

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
            <Section title="Intros and credits" description="Uses the intro and credits markers Plex detects for each file.">
              <Row label="Skip intros" hint="Automatically jumps past the intro. Show button lets you choose each time.">
                <Segmented value={prefs.skipIntro} options={SKIP_OPTIONS} onChange={(v) => savePrefs({ skipIntro: v })} />
              </Row>
              <Row
                label="Skip credits"
                hint="When the ending credits start, episodes move on to the next one and movies finish. Automatically gives you 10 seconds to cancel."
              >
                <Segmented value={prefs.skipCredits} options={SKIP_OPTIONS} onChange={(v) => savePrefs({ skipCredits: v })} />
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
          </>
        )}

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
