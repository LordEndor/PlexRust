import { useEffect, useState } from "react";
import { Check, Download, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { errorMessage } from "@/lib/api";
import { playback, type ExternalSubtitle, type SubtitleResult } from "@/lib/player";
import { LANGUAGES, usePrefs } from "@/lib/prefs";

/** Two-letter code Plex searches with, from a language list such as "sv,swe". */
function searchCode(list: string | undefined) {
  const first = list?.split(",")[0]?.trim();
  return first && first !== "off" ? first : "en";
}

/**
 * Finds subtitles online through the Plex server's subtitle agents
 * (OpenSubtitles by default) and downloads the picked one into Plex, so it's
 * there next time too.
 */
export function SubtitleSearch({
  ratingKey,
  title,
  onClose,
  onDownloaded,
}: {
  ratingKey: string;
  title: string;
  onClose: () => void;
  onDownloaded: (all: ExternalSubtitle[]) => void;
}) {
  const prefs = usePrefs();
  const [language, setLanguage] = useState<string | null>(null);
  const [hearingImpaired, setHearingImpaired] = useState(false);
  const [results, setResults] = useState<SubtitleResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  // Start with the subtitle language from Settings, once it's loaded.
  useEffect(() => {
    if (prefs && language === null) setLanguage(searchCode(prefs.subtitleLanguage || prefs.audioLanguage));
  }, [prefs, language]);

  useEffect(() => {
    if (!language) return;
    let live = true;
    setResults(null);
    setError(null);
    playback
      .searchSubtitles(ratingKey, language, hearingImpaired)
      .then((r) => live && setResults(r))
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [ratingKey, language, hearingImpaired]);

  const download = async (r: SubtitleResult) => {
    setDownloading(r.key);
    setError(null);
    try {
      onDownloaded(await playback.downloadSubtitle(ratingKey, r.key));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-4 p-6">
        <div>
          <DialogTitle>Search for subtitles</DialogTitle>
          <DialogDescription className="truncate">{title}</DialogDescription>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Language"
            value={language ?? ""}
            onChange={(e) => setLanguage(e.target.value)}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={searchCode(l.value)}>
                {l.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hearingImpaired}
              onChange={(e) => setHearingImpaired(e.target.checked)}
              className="accent-primary"
            />
            Hearing impaired (SDH)
          </label>
        </div>
        {error && <p className="text-destructive text-sm break-words">{error}</p>}
        <div className="-mx-2 min-h-40 overflow-y-auto">
          {results === null && !error && (
            <div className="grid h-40 place-items-center">
              <Loader2 className="text-muted-foreground size-6 animate-spin" />
            </div>
          )}
          {results?.length === 0 && (
            <p className="text-muted-foreground px-2 py-8 text-center text-sm">
              Nothing found in this language. Plex searches with the subtitle agents turned on under Settings → Agents on
              the server.
            </p>
          )}
          {results?.map((r) => (
            <div key={r.key} className="hover:bg-accent/50 flex items-center gap-3 rounded-lg px-2 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium" title={r.title ?? undefined}>
                  {r.title || r.displayTitle || r.language || "Subtitle"}
                </div>
                <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                  {r.providerTitle && <span>{r.providerTitle}</span>}
                  {r.codec && <span>· {r.codec.toUpperCase()}</span>}
                  {r.score != null && <span>· score {Math.round(r.score)}</span>}
                  {r.perfectMatch && <Badge variant="secondary">Exact match</Badge>}
                  {r.hearingImpaired && <Badge variant="outline">SDH</Badge>}
                </div>
              </div>
              {r.downloaded ? (
                <span className="text-muted-foreground flex items-center gap-1 text-xs">
                  <Check className="size-4" /> Downloaded
                </span>
              ) : (
                <Button size="sm" variant="outline" disabled={downloading !== null} onClick={() => download(r)}>
                  {downloading === r.key ? <Loader2 className="animate-spin" /> : <Download />}
                  Use
                </Button>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
